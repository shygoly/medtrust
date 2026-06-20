"""Declarative SecretFlowTaskSpec parsing + validation (data-plane side).

Mirrors the TypeScript ``isSecretFlowTaskSpec`` guard in
``apps/connector/src/domain/secretflow/secretflow-task-spec.ts`` so the agent
independently rejects malformed specs even if the control plane is bypassed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import yaml

PARTY_ROLES = ("provider", "consumer", "coordinator")
MODALITY_TYPES = ("dicom", "genomics", "clinical_text", "structured_ehr")
ARTIFACT_KINDS = (
    "lora_delta_hash",
    "encrypted_delta_ref",
    "aggregate_metrics",
    "attestation_report",
    "model_card",
)


class SpecValidationError(ValueError):
    """Raised when a SecretFlowTaskSpec is structurally invalid."""


@dataclass(frozen=True)
class Party:
    participant_id: str
    role: str
    space_id: Optional[str] = None
    connector_id: Optional[str] = None
    data_residency: Optional[str] = None


@dataclass(frozen=True)
class Modality:
    type: str
    data_product_id: Optional[str] = None
    manifest_uri: Optional[str] = None
    count: Optional[int] = None
    schema: Optional[str] = None


@dataclass(frozen=True)
class LlmBackbone:
    model_type: str
    model_name_or_path: str


@dataclass(frozen=True)
class PeftStrategy:
    type: str
    r: int
    alpha: int
    target_modules: List[str]


@dataclass(frozen=True)
class FusionBridge:
    type: str
    hidden_size: int
    num_queries: Optional[int] = None


@dataclass(frozen=True)
class DpSgd:
    clip_norm: float
    noise_multiplier: float
    target_epsilon: Optional[float] = None


@dataclass(frozen=True)
class Privacy:
    tee_required: bool
    heu_enabled: bool
    dp_sgd: Optional[DpSgd] = None


@dataclass(frozen=True)
class SecretFlowTaskSpec:
    parties: List[Party]
    modalities: List[Modality]
    llm_backbone: LlmBackbone
    peft_strategy: PeftStrategy
    privacy: Privacy
    allowed_artifacts: List[str]
    fusion_bridge: Optional[FusionBridge] = None
    epochs: int = 3
    raw: Dict[str, Any] = field(default_factory=dict)

    def canonical_json(self) -> str:
        return json.dumps(self.raw, sort_keys=True, separators=(",", ":"))


def _require(cond: bool, message: str) -> None:
    if not cond:
        raise SpecValidationError(message)


def _camel(d: Dict[str, Any], camel: str, snake: str) -> Any:
    """Accept both camelCase (control-plane JSON) and snake_case (YAML) keys."""
    if camel in d:
        return d[camel]
    return d.get(snake)


def parse_spec(source: Any) -> SecretFlowTaskSpec:
    """Parse a spec from a YAML string, JSON string, or already-decoded dict."""
    if isinstance(source, (str, bytes)):
        data = yaml.safe_load(source)
    else:
        data = source
    _require(isinstance(data, dict), "spec must be a mapping")

    raw_parties = data.get("parties")
    _require(
        isinstance(raw_parties, list) and len(raw_parties) > 0,
        "spec.parties must declare at least one party",
    )
    parties: List[Party] = []
    for p in raw_parties:
        _require(isinstance(p, dict), "each party must be a mapping")
        pid = _camel(p, "participantId", "participant_id")
        role = p.get("role")
        _require(isinstance(pid, str) and pid.strip() != "", "party.participantId required")
        _require(role in PARTY_ROLES, f"party.role must be one of {PARTY_ROLES}")
        parties.append(
            Party(
                participant_id=pid,
                role=role,
                space_id=_camel(p, "spaceId", "space_id"),
                connector_id=_camel(p, "connectorId", "connector_id"),
                data_residency=_camel(p, "dataResidency", "data_residency"),
            )
        )

    raw_modalities = data.get("modalities")
    _require(
        isinstance(raw_modalities, list) and len(raw_modalities) > 0,
        "spec.modalities must declare at least one modality",
    )
    modalities: List[Modality] = []
    for m in raw_modalities:
        _require(isinstance(m, dict), "each modality must be a mapping")
        mtype = m.get("type")
        _require(mtype in MODALITY_TYPES, f"modality.type must be one of {MODALITY_TYPES}")
        modalities.append(
            Modality(
                type=mtype,
                data_product_id=_camel(m, "dataProductId", "data_product_id"),
                manifest_uri=_camel(m, "manifestUri", "manifest_uri"),
                count=m.get("count"),
                schema=m.get("schema"),
            )
        )

    raw_backbone = _camel(data, "llmBackbone", "llm_backbone")
    _require(isinstance(raw_backbone, dict), "spec.llmBackbone required")
    model_type = _camel(raw_backbone, "modelType", "model_type")
    model_path = _camel(raw_backbone, "modelNameOrPath", "model_name_or_path")
    _require(isinstance(model_type, str) and model_type.strip() != "", "llmBackbone.modelType required")
    _require(isinstance(model_path, str) and model_path.strip() != "", "llmBackbone.modelNameOrPath required")
    backbone = LlmBackbone(model_type=model_type, model_name_or_path=model_path)

    raw_peft = _camel(data, "peftStrategy", "peft_strategy")
    _require(isinstance(raw_peft, dict), "spec.peftStrategy required")
    _require(raw_peft.get("type") == "lora", "peftStrategy.type must be 'lora'")
    r = raw_peft.get("r")
    alpha = raw_peft.get("alpha")
    target_modules = _camel(raw_peft, "targetModules", "target_modules")
    _require(isinstance(r, int) and r >= 1, "peftStrategy.r must be an int >= 1")
    _require(isinstance(alpha, (int, float)) and alpha >= 1, "peftStrategy.alpha must be >= 1")
    _require(
        isinstance(target_modules, list)
        and len(target_modules) > 0
        and all(isinstance(t, str) and t.strip() for t in target_modules),
        "peftStrategy.targetModules must be a non-empty list of strings",
    )
    peft = PeftStrategy(type="lora", r=int(r), alpha=int(alpha), target_modules=list(target_modules))

    raw_privacy = data.get("privacy")
    _require(isinstance(raw_privacy, dict), "spec.privacy required")
    tee_required = _camel(raw_privacy, "teeRequired", "tee_required")
    heu_enabled = _camel(raw_privacy, "heuEnabled", "heu_enabled")
    _require(isinstance(tee_required, bool), "privacy.teeRequired must be a bool")
    _require(isinstance(heu_enabled, bool), "privacy.heuEnabled must be a bool")
    dp_sgd = None
    raw_dp = _camel(raw_privacy, "dpSgd", "dp_sgd")
    if isinstance(raw_dp, dict):
        dp_sgd = DpSgd(
            clip_norm=float(_camel(raw_dp, "clipNorm", "clip_norm")),
            noise_multiplier=float(_camel(raw_dp, "noiseMultiplier", "noise_multiplier")),
            target_epsilon=_camel(raw_dp, "targetEpsilon", "target_epsilon"),
        )
    privacy = Privacy(tee_required=tee_required, heu_enabled=heu_enabled, dp_sgd=dp_sgd)

    raw_output = _camel(data, "outputPolicy", "output_policy")
    _require(isinstance(raw_output, dict), "spec.outputPolicy required")
    allowed = _camel(raw_output, "allowedArtifacts", "allowed_artifacts")
    _require(
        isinstance(allowed, list)
        and len(allowed) > 0
        and all(a in ARTIFACT_KINDS for a in allowed),
        f"outputPolicy.allowedArtifacts must be a non-empty subset of {ARTIFACT_KINDS}",
    )

    fusion = None
    raw_fusion = _camel(data, "fusionBridge", "fusion_bridge")
    if isinstance(raw_fusion, dict):
        fusion = FusionBridge(
            type=raw_fusion.get("type"),
            hidden_size=int(_camel(raw_fusion, "hiddenSize", "hidden_size")),
            num_queries=_camel(raw_fusion, "numQueries", "num_queries"),
        )

    epochs = data.get("epochs", 3)
    _require(isinstance(epochs, int) and epochs >= 1, "epochs must be an int >= 1")

    return SecretFlowTaskSpec(
        parties=parties,
        modalities=modalities,
        llm_backbone=backbone,
        peft_strategy=peft,
        privacy=privacy,
        allowed_artifacts=list(allowed),
        fusion_bridge=fusion,
        epochs=epochs,
        raw=data if isinstance(data, dict) else {},
    )
