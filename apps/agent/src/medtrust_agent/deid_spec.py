"""Strict validation for the connector-signed de-identification specification.

The agent deliberately validates the spec again instead of trusting the connector.
This module does not execute arbitrary Python and does not read a data source.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


DEID_SPEC_VERSION = 1
DEID_OPERATORS = frozenset(
    {
        "drop",
        "keep",
        "generalize",
        "hmac_pseudonym",
        "date_shift",
        "text_rules",
        "bucketize",
        "truncate",
        "suppress",
    }
)
FLOW_LEVELS = frozenset({"C0_internal", "C0", "C1", "C2", "C3"})


class DeidSpecError(ValueError):
    """A malformed or unsafe specification; callers must fail closed."""


@dataclass(frozen=True)
class DeidTransform:
    field: str
    op: str
    params: Mapping[str, Any]


@dataclass(frozen=True)
class DeidSpec:
    version: int
    spec_id: str
    product: str
    level: str
    transforms: tuple[DeidTransform, ...]
    deny_if_transform_missing: tuple[str, ...]
    quasi_identifier_k: int | None = None
    quasi_identifier_columns: tuple[str, ...] = ()
    suppress_if_below: bool = False


def parse_deid_spec(raw: Any) -> DeidSpec:
    if not isinstance(raw, Mapping):
        raise DeidSpecError("spec must be an object")
    if raw.get("version") != DEID_SPEC_VERSION:
        raise DeidSpecError("unsupported de-identification spec version")
    spec_id = _string(raw.get("id"), "id")
    scope = raw.get("scope")
    if not isinstance(scope, Mapping):
        raise DeidSpecError("scope must be an object")
    product = _string(scope.get("product"), "scope.product")
    level = _string(scope.get("level"), "scope.level")
    if level not in FLOW_LEVELS:
        raise DeidSpecError("scope.level is invalid")

    raw_transforms = raw.get("transforms")
    if not isinstance(raw_transforms, Sequence) or isinstance(raw_transforms, (str, bytes)):
        raise DeidSpecError("transforms must be a non-empty array")
    if not raw_transforms:
        raise DeidSpecError("transforms must not be empty")
    transforms = tuple(_parse_transform(item, index) for index, item in enumerate(raw_transforms))
    fields = [item.field for item in transforms]
    if len(set(fields)) != len(fields):
        raise DeidSpecError("transform fields must be unique")

    mandatory = _strings(raw.get("denyIfTransformMissing"), "denyIfTransformMissing")
    missing = [field for field in mandatory if field not in set(fields)]
    if missing:
        raise DeidSpecError(f"mandatory fields have no transform: {', '.join(missing)}")

    policy = raw.get("quasiIdentifierPolicy")
    k = None
    columns: tuple[str, ...] = ()
    suppress = False
    if policy is not None:
        if not isinstance(policy, Mapping):
            raise DeidSpecError("quasiIdentifierPolicy must be an object")
        value = policy.get("k")
        if not isinstance(value, int) or isinstance(value, bool) or value < 5:
            raise DeidSpecError("quasiIdentifierPolicy.k must be >= 5")
        if not isinstance(policy.get("suppressIfBelow"), bool):
            raise DeidSpecError("quasiIdentifierPolicy.suppressIfBelow must be boolean")
        k = value
        suppress = policy["suppressIfBelow"]
        columns = tuple(_strings(policy.get("columns"), "quasiIdentifierPolicy.columns"))

    return DeidSpec(
        version=DEID_SPEC_VERSION,
        spec_id=spec_id,
        product=product,
        level=level,
        transforms=transforms,
        deny_if_transform_missing=tuple(mandatory),
        quasi_identifier_k=k,
        quasi_identifier_columns=columns,
        suppress_if_below=suppress,
    )


def _parse_transform(raw: Any, index: int) -> DeidTransform:
    path = f"transforms[{index}]"
    if not isinstance(raw, Mapping):
        raise DeidSpecError(f"{path} must be an object")
    field = _string(raw.get("field"), f"{path}.field")
    op = _string(raw.get("op"), f"{path}.op")
    if op not in DEID_OPERATORS:
        raise DeidSpecError(f"{path}.op is not allowed")
    params = raw.get("params")
    if params is None:
        params = {}
    if not isinstance(params, Mapping):
        raise DeidSpecError(f"{path}.params must be an object")
    params = dict(params)
    if op == "hmac_pseudonym":
        _string(params.get("saltRef"), f"{path}.params.saltRef")
        out_len = params.get("outLen")
        if not isinstance(out_len, int) or isinstance(out_len, bool) or not 1 <= out_len <= 64:
            raise DeidSpecError(f"{path}.params.outLen must be between 1 and 64")
    if op == "date_shift":
        max_days = params.get("maxDays")
        if not isinstance(max_days, int) or isinstance(max_days, bool) or not 0 <= max_days <= 30:
            raise DeidSpecError(f"{path}.params.maxDays must be between 0 and 30")
        if "perSubject" in params and not isinstance(params["perSubject"], bool):
            raise DeidSpecError(f"{path}.params.perSubject must be boolean")
    if op == "text_rules":
        _strings(params.get("rules"), f"{path}.params.rules")
        if "dictionaryRef" in params:
            _string(params["dictionaryRef"], f"{path}.params.dictionaryRef")
    if op in {"truncate", "bucketize"} and not params:
        raise DeidSpecError(f"{path}.params must not be empty")
    return DeidTransform(field=field, op=op, params=params)


def _string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DeidSpecError(f"{path} must be a non-empty string")
    return value.strip()


def _strings(value: Any, path: str) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise DeidSpecError(f"{path} must be a string array")
    result = [_string(item, f"{path}[]") for item in value]
    return list(dict.fromkeys(result))
