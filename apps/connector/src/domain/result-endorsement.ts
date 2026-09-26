// on-chain-provider-endorsement — 连接器对**结果哈希**的结果级 SM2 背书(design D1)。
//
// 与传输层签名(`ts:pid:bodySm3`,ConnectorTokenGuard 在 ingress 验一次即弃)不同:
// 结果级签名的被签对象是**稳定的结果摘要 resultSm3**,随结果上链,任何人凭
// 平台 CA 签发的连接器证书即可脱离平台独立核验「该院背书了这份结果」。
//
// 载荷口径(`medtrust.result-endorsement.v1:<sm3>`)与平台侧
// apps/api/src/runtime/rws-orchestrator/result-endorsement.ts 必须一致(两处改动须同步)。
// 加前缀做域分离:这条签名不能被拿去冒充任务签名/传输签名,反之亦然。
import { signSm2 } from './sm2-sign';

export const RESULT_ENDORSEMENT_PAYLOAD_PREFIX = 'medtrust.result-endorsement.v1:';

export function resultEndorsementPayload(resultSm3: string): string {
  return `${RESULT_ENDORSEMENT_PAYLOAD_PREFIX}${resultSm3.toLowerCase()}`;
}

/** 随 complete 回传的背书三件套(平台按院验签 + 持久化 + 上链)。 */
export interface ResultEndorsement {
  resultSm3: string;
  connectorResultSig: string;
  connectorCertFingerprint: string;
}

/**
 * 用院内证书私钥对 resultSm3 做 SM2 签名。
 * 未配置私钥/指纹时返回 undefined —— 由平台侧按渐进/fail-closed 开关决定是否拒该院贡献;
 * 连接器这边不自行降级、不伪造背书。
 */
export function signResultEndorsement(
  resultSm3: string,
  privateKey: string,
  certFingerprint: string,
): ResultEndorsement | undefined {
  const sm3 = (resultSm3 ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sm3)) return undefined;
  if (!privateKey?.trim() || !certFingerprint?.trim()) return undefined;
  try {
    return {
      resultSm3: sm3,
      connectorResultSig: signSm2(resultEndorsementPayload(sm3), privateKey.trim()),
      connectorCertFingerprint: certFingerprint.trim(),
    };
  } catch {
    return undefined;
  }
}
