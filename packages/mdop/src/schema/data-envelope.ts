import { MdopError } from "../errors";
import type { AttestationPolicy } from "../label/lattice";
import {
  SchemaError,
  asObject,
  checkKeys,
  reqArray,
  reqDigest,
  reqObject,
  reqString,
} from "./strict";

/**
 * 数据信封（协议 §9.3、决策 D-TEE-1 / D13）。
 *
 * C2 只有这一种形态：C0 制品经 `seal` 封装成信封后才可以流向可信空间节点；
 * 节点内解封后视为该节点的 C0。信封自带使用策略，**解密之前**就要按策略判定，
 * 不能「先解开再检查」。
 *
 * 本实现相对协议示例补了一处（已同步协议 §9.3 补注）：`aad` 必填——AEAD 的附加数据
 * MUST 绑定作业、执行凭证与合约，否则同一份密文可以在别的作业里被重放使用。
 */

export const DATA_ENVELOPE_VERSION = "mdop.env/1.0" as const;

/** 本期只允许「出域仅 C3」——其他出口形态（如导出副本）未开放，出现即拒。 */
export const ENVELOPE_EXPORT_MODES = ["C3_only"] as const;
export type EnvelopeExportMode = (typeof ENVELOPE_EXPORT_MODES)[number];

export interface EnvelopeBinding {
  job_id: string;
  credential_id: string;
  contract_id: string;
}

export interface DataEnvelope {
  envelope: typeof DATA_ENVELOPE_VERSION;
  payload: {
    cipher: string;
    ciphertext_ref: string;
    /** 密文摘要（`sm3:<64hex>`）。 */
    digest: string;
  };
  wrapped_key: { kms: string; key_id: string };
  policy: {
    contract: string;
    purpose: string[];
    allowed_ops: string[];
    attestation_policy: AttestationPolicy;
    export: EnvelopeExportMode;
    not_after: string;
  };
  watermark: string;
  origin_sig: { signer: string; alg: string; value: string };
  /** AEAD 附加数据绑定：换作业 / 换凭证 / 换合约即解不开。 */
  aad: EnvelopeBinding;
}

export function parseDataEnvelope(input: unknown): DataEnvelope {
  const obj = asObject(input, "envelope");
  checkKeys(obj, "envelope", {
    required: [
      "envelope",
      "payload",
      "wrapped_key",
      "policy",
      "watermark",
      "origin_sig",
      "aad",
    ],
  });

  const version = reqString(obj, "envelope", "envelope");
  if (version !== DATA_ENVELOPE_VERSION)
    throw new SchemaError("envelope.envelope", `只接受 ${DATA_ENVELOPE_VERSION}`);

  const payload = reqObject(obj, "payload", "envelope");
  checkKeys(payload, "envelope.payload", {
    required: ["cipher", "ciphertext_ref", "digest"],
  });
  const digest = reqDigest(payload, "digest", "envelope.payload");

  const wrapped = reqObject(obj, "wrapped_key", "envelope");
  checkKeys(wrapped, "envelope.wrapped_key", { required: ["kms", "key_id"] });

  const policy = reqObject(obj, "policy", "envelope");
  checkKeys(policy, "envelope.policy", {
    required: ["contract", "purpose", "allowed_ops", "attestation_policy", "export", "not_after"],
  });
  const exportMode = reqString(policy, "export", "envelope.policy");
  if (!(ENVELOPE_EXPORT_MODES as readonly string[]).includes(exportMode))
    throw new SchemaError(
      "envelope.policy.export",
      `本期只允许 ${ENVELOPE_EXPORT_MODES.join(" / ")}（收到 ${exportMode}）`,
    );

  const attestation = reqObject(policy, "attestation_policy", "envelope.policy");
  checkKeys(attestation, "envelope.policy.attestation_policy", {
    required: ["tee"],
    optional: ["min_tcb", "allowed_measurements"],
  });
  const tee = reqArray(attestation, "tee", "envelope.policy.attestation_policy").map((t, i) => {
    if (typeof t !== "string")
      throw new SchemaError(`envelope.policy.attestation_policy.tee[${i}]`, "必须是字符串");
    return t;
  });
  const minRaw = attestation.min_tcb;
  let minTcb: AttestationPolicy["min_tcb"];
  if (typeof minRaw === "string") minTcb = minRaw;
  else if (minRaw && typeof minRaw === "object" && !Array.isArray(minRaw)) {
    const map: Record<string, string> = {};
    for (const [kind, value] of Object.entries(minRaw as Record<string, unknown>)) {
      if (typeof value !== "string")
        throw new SchemaError(
          `envelope.policy.attestation_policy.min_tcb.${kind}`,
          "阈值必须是字符串",
        );
      map[kind] = value;
    }
    minTcb = map;
  } else if (minRaw !== undefined) {
    throw new SchemaError("envelope.policy.attestation_policy.min_tcb", "只接受字符串或按链映射");
  }
  const measurements = attestation.allowed_measurements;
  const allowedMeasurements =
    measurements === undefined
      ? undefined
      : reqArray(attestation, "allowed_measurements", "envelope.policy.attestation_policy").map(
          (m, i) => {
            if (typeof m !== "string")
              throw new SchemaError(
                `envelope.policy.attestation_policy.allowed_measurements[${i}]`,
                "必须是字符串",
              );
            return m;
          },
        );

  const originSig = reqObject(obj, "origin_sig", "envelope");
  checkKeys(originSig, "envelope.origin_sig", { required: ["signer", "alg", "value"] });

  const aad = reqObject(obj, "aad", "envelope");
  checkKeys(aad, "envelope.aad", { required: ["job_id", "credential_id", "contract_id"] });

  return {
    envelope: DATA_ENVELOPE_VERSION,
    payload: {
      cipher: reqString(payload, "cipher", "envelope.payload"),
      ciphertext_ref: reqString(payload, "ciphertext_ref", "envelope.payload"),
      digest,
    },
    wrapped_key: {
      kms: reqString(wrapped, "kms", "envelope.wrapped_key"),
      key_id: reqString(wrapped, "key_id", "envelope.wrapped_key"),
    },
    policy: {
      contract: reqString(policy, "contract", "envelope.policy"),
      purpose: reqArray(policy, "purpose", "envelope.policy").map((p, i) => {
        if (typeof p !== "string")
          throw new SchemaError(`envelope.policy.purpose[${i}]`, "必须是字符串");
        return p;
      }),
      allowed_ops: reqArray(policy, "allowed_ops", "envelope.policy").map((o, i) => {
        if (typeof o !== "string")
          throw new SchemaError(`envelope.policy.allowed_ops[${i}]`, "必须是字符串");
        return o;
      }),
      attestation_policy: {
        tee,
        ...(minTcb !== undefined ? { min_tcb: minTcb } : {}),
        ...(allowedMeasurements !== undefined
          ? { allowed_measurements: allowedMeasurements }
          : {}),
      },
      export: exportMode as EnvelopeExportMode,
      not_after: reqString(policy, "not_after", "envelope.policy"),
    },
    watermark: reqString(obj, "watermark", "envelope"),
    origin_sig: {
      signer: reqString(originSig, "signer", "envelope.origin_sig"),
      alg: reqString(originSig, "alg", "envelope.origin_sig"),
      value: reqString(originSig, "value", "envelope.origin_sig"),
    },
    aad: {
      job_id: reqString(aad, "job_id", "envelope.aad"),
      credential_id: reqString(aad, "credential_id", "envelope.aad"),
      contract_id: reqString(aad, "contract_id", "envelope.aad"),
    },
  };
}

/**
 * 解封前的绑定核对（协议 §9.3 的 AAD 要求）。
 *
 * 真实实现的这一层由 AEAD 本身保证（AAD 不符则认证失败）；这里是**同一判据的显式版本**，
 * 供入口守卫在解密前先拒绝，也给单测一个不依赖密码学库的落点。
 */
export function assertEnvelopeBinding(
  envelope: DataEnvelope,
  expect_: EnvelopeBinding,
): void {
  const { aad } = envelope;
  if (
    aad.job_id !== expect_.job_id ||
    aad.credential_id !== expect_.credential_id ||
    aad.contract_id !== expect_.contract_id
  ) {
    throw new MdopError("E_ENVELOPE_POLICY", {}, "信封的绑定信息与本作业不符");
  }
  if (envelope.policy.contract !== expect_.contract_id) {
    throw new MdopError("E_ENVELOPE_POLICY", {}, "信封策略里的合约与绑定信息不一致");
  }
}
