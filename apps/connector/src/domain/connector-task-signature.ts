// outbound-longpoll-agent-auth(D4)—— 连接器对下发任务验签。
//
// 平台对任务规范化内容算 SM3,再用平台 CA 私钥做 SM2 签名;连接器用部署配置里
// 固定的平台 CA 公钥(CONNECTOR_PLATFORM_CA_PUBKEY,与 Wasm 变更共用)验签。
// 经过 Cloudflare / nginx 的任务内容无法被篡改(TLS 在那里就终结了)。
import { sm2 } from 'sm-crypto';
import { stableStringify } from './canonical-json';
import { sm3Hex } from './sm3';

/** 签名载荷口径:对任务摘要加域分隔前缀后再验。平台侧同串(connector-task-signer.service.ts)。 */
export const CONNECTOR_TASK_SIGNATURE_PREFIX = 'medtrust.connector-task.v1:';

export function connectorTaskSignaturePayload(sm3: string): string {
  return `${CONNECTOR_TASK_SIGNATURE_PREFIX}${sm3.toLowerCase()}`;
}

export type ConnectorTaskKind = 'rws' | 'fl-prediction' | 'fl-round';

export interface SignedConnectorTask<T = unknown> {
  kind: ConnectorTaskKind;
  /** 目标任务参与方(必须等于本连接器身份)。 */
  participantId: string;
  /** 去重与回执标识:RWS/FL 预测 = assignmentId;训练轮次 = roundTaskId。 */
  taskId: string;
  issuedAt: string;
  payload: T;
  sm3: string;
  signature: string;
  algorithm?: string;
}

export type TaskVerificationFailure =
  | 'malformed'
  | 'wrong-participant'
  | 'sm3-mismatch'
  | 'signature-invalid'
  | 'expired'
  | 'no-platform-ca-pubkey';

export interface TaskVerificationOk<T> {
  ok: true;
  task: SignedConnectorTask<T>;
}

export interface TaskVerificationErr {
  ok: false;
  reason: TaskVerificationFailure;
  detail: string;
}

export interface VerifyTaskOptions {
  /** 本连接器参与方 id。 */
  participantId: string;
  /** 部署配置里固定的平台 CA 公钥。 */
  platformCaPublicKey: string;
  now?: number;
  /** 签发时间最大年龄(默认 10 分钟)。 */
  maxAgeMs?: number;
  /** 允许的时钟超前量(默认 2 分钟)。 */
  maxFutureMs?: number;
}

export function connectorTaskCanonical(input: {
  participantId: string;
  taskKind: string;
  taskId: string;
  issuedAt: string;
  payload: unknown;
}): string {
  return stableStringify({
    participantId: input.participantId,
    taskKind: input.taskKind,
    taskId: input.taskId,
    issuedAt: input.issuedAt,
    payload: input.payload,
  });
}

export function connectorTaskSm3(input: {
  participantId: string;
  taskKind: string;
  taskId: string;
  issuedAt: string;
  payload: unknown;
}): string {
  return sm3Hex(connectorTaskCanonical(input));
}

const DEFAULT_MAX_AGE_MS = 10 * 60_000;
const DEFAULT_MAX_FUTURE_MS = 2 * 60_000;
const KINDS: readonly string[] = ['rws', 'fl-prediction', 'fl-round'];

/**
 * 验签 + 三项检查（design D4）：目标参与方是自己、签发时间在时效内、摘要与签名都过。
 * taskId 去重由 ConnectorTaskDedupe 负责（需要跨请求状态）。
 */
export function verifySignedConnectorTask<T>(
  task: unknown,
  opts: VerifyTaskOptions,
): TaskVerificationOk<T> | TaskVerificationErr {
  const t = task as Partial<SignedConnectorTask<T>> | null;
  if (
    !t ||
    typeof t !== 'object' ||
    !KINDS.includes(String(t.kind)) ||
    typeof t.taskId !== 'string' ||
    !t.taskId ||
    typeof t.participantId !== 'string' ||
    typeof t.issuedAt !== 'string' ||
    typeof t.sm3 !== 'string' ||
    typeof t.signature !== 'string' ||
    !t.signature ||
    t.payload === undefined
  ) {
    return { ok: false, reason: 'malformed', detail: '任务信封结构不完整' };
  }

  if (t.participantId !== opts.participantId) {
    return {
      ok: false,
      reason: 'wrong-participant',
      detail: `任务目标参与方为 ${t.participantId},本连接器为 ${opts.participantId}`,
    };
  }

  const issuedAt = new Date(t.issuedAt).getTime();
  if (!Number.isFinite(issuedAt)) {
    return { ok: false, reason: 'malformed', detail: '签发时间格式非法' };
  }
  const now = opts.now ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (now - issuedAt > maxAgeMs) {
    return {
      ok: false,
      reason: 'expired',
      detail: `任务签发时间过期(${Math.round((now - issuedAt) / 1000)}s > ${Math.round(maxAgeMs / 1000)}s)`,
    };
  }
  if (issuedAt - now > (opts.maxFutureMs ?? DEFAULT_MAX_FUTURE_MS)) {
    return {
      ok: false,
      reason: 'expired',
      detail: '任务签发时间在未来(时钟偏差过大)',
    };
  }

  const caPublicKey = opts.platformCaPublicKey?.trim();
  if (!caPublicKey) {
    return {
      ok: false,
      reason: 'no-platform-ca-pubkey',
      detail:
        '未配置 CONNECTOR_PLATFORM_CA_PUBKEY,无法验证任务签名 —— 拒绝执行(fail-closed)',
    };
  }

  const canonical = connectorTaskCanonical({
    participantId: t.participantId,
    taskKind: String(t.kind),
    taskId: t.taskId,
    issuedAt: t.issuedAt,
    payload: t.payload,
  });
  const expectedSm3 = sm3Hex(canonical);
  if (expectedSm3 !== t.sm3.toLowerCase()) {
    return {
      ok: false,
      reason: 'sm3-mismatch',
      detail: `任务内容与签名摘要不符(重算 ${expectedSm3.slice(0, 16)}… ≠ 声明 ${String(t.sm3).slice(0, 16)}…)`,
    };
  }

  let signatureOk = false;
  try {
    signatureOk = sm2.doVerifySignature(
      connectorTaskSignaturePayload(expectedSm3),
      t.signature,
      caPublicKey,
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return {
      ok: false,
      reason: 'signature-invalid',
      detail: `任务签名无法用部署固定的平台 CA 公钥验证(sm3=${expectedSm3.slice(0, 16)}…)`,
    };
  }

  return { ok: true, task: t as SignedConnectorTask<T> };
}
