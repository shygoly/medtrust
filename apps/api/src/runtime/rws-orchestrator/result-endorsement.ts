// on-chain-provider-endorsement — 平台侧结果级背书口径与收集(design D1/D2/D5)。
//
// 载荷口径必须与连接器 apps/connector/src/domain/result-endorsement.ts 一致
// (两处改动须同步)。前缀做域分离:结果背书签名不可与任务签名/传输签名互换。
import { RwsAssignmentEntity } from "@medtrust/database";

export const RESULT_ENDORSEMENT_PAYLOAD_PREFIX =
  "medtrust.result-endorsement.v1:";

export function resultEndorsementPayload(resultSm3: string): string {
  return `${RESULT_ENDORSEMENT_PAYLOAD_PREFIX}${resultSm3.toLowerCase()}`;
}

/** 上链 payload 里按贡献方带的背书条目(D2)。 */
export interface ProviderEndorsement {
  participantId: string;
  resultSm3: string;
  sig: string;
  certFingerprint: string;
}

/** 连接器回传 complete 时可携带的背书字段。 */
export interface ResultEndorsementInput {
  resultSm3?: string;
  connectorResultSig?: string;
  connectorCertFingerprint?: string;
}

/**
 * fail-closed 开关(迁移用,见 design Migration Plan):
 * 默认渐进 —— 无签名不破坏任务,有签名则必须验过。
 * `RWS_ENDORSEMENT_REQUIRED=true` 后切强制:无/错结果签名即拒该院贡献。
 */
export function endorsementRequired(): boolean {
  return (
    (process.env.RWS_ENDORSEMENT_REQUIRED ?? "").trim().toLowerCase() === "true"
  );
}

/**
 * 从派发记录里收集各院背书,按 participantId 排序使上链 payload 确定
 * (与合并结果哈希同样不依赖回传顺序)。只收「三件套齐全」的记录 —— 渐进期
 * 未升级的连接器没有背书,不产生半截条目。
 */
export function collectEndorsements(
  assignments: Array<
    Pick<
      RwsAssignmentEntity,
      | "providerId"
      | "status"
      | "resultSm3"
      | "connectorResultSig"
      | "connectorCertFingerprint"
    >
  >,
): ProviderEndorsement[] {
  return assignments
    .filter(
      (a) =>
        a.status === "completed" &&
        !!a.resultSm3 &&
        !!a.connectorResultSig &&
        !!a.connectorCertFingerprint,
    )
    .map((a) => ({
      participantId: a.providerId,
      resultSm3: (a.resultSm3 as string).toLowerCase(),
      sig: a.connectorResultSig as string,
      certFingerprint: a.connectorCertFingerprint as string,
    }))
    .sort((x, y) => x.participantId.localeCompare(y.participantId));
}
