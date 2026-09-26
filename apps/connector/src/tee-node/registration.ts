import { sm3Hex } from '@medtrust/mdop';
import { signSm2 } from '../domain/sm2-sign';
import { stableStringify } from '../domain/canonical-json';

/**
 * 可信空间节点的**注册与心跳**（任务 3.1）。
 *
 * 与数据持有方连接器**同一套端点与认证**，理由很直接：节点是 MDOP 的一等参与方，
 * 它要出现在编译器的能力表里（`cp_connector_registry` 的 `mdop` 字段），
 * 平台也只用一套证书与签名口径来认它——不为「节点」另开一条注册通道。
 *
 *  - **注册**：`POST /connectors/register`（operator JWT）→ 只提交**公钥**；
 *    平台返回证书指纹，节点把它写进 `TEE_NODE_CERT_FINGERPRINT`（心跳用它做认证）。
 *  - **心跳**：`POST /connector/heartbeat`，用**证书签名头**（指纹 + 时间戳 + 对
 *    `ts:pid[:bodySm3]` 的国密签名）认证；`mdop` 字段带**能力通告**。
 *
 * 能力通告由 `nodeCapabilityAdvertisement` **真跑一次证明**得出：软件提供者恒 `tee: null`，
 * 因此「先用软件顶上、让编译器把 C2 放过来」这条路在注册那一刻就是堵死的。
 */

export interface NodeRegistrationResult {
  fingerprint: string;
  /** 平台响应里**不得**出现私钥字段（出现即视为严重违约）。 */
  warnedAboutPrivateKey: boolean;
}

export async function registerNode(input: {
  baseUrl: string;
  participantId: string;
  publicKey: string;
  /** operator 角色的 JWT（注册接口需要它）。 */
  operatorToken: string;
  connectorId?: string;
  fetchImpl?: typeof fetch;
}): Promise<NodeRegistrationResult> {
  if (!input.publicKey) throw new Error('注册必须提交公钥');
  if (!input.operatorToken) throw new Error('注册需要 operator 令牌（--token）');
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl(`${input.baseUrl.replace(/\/$/, '')}/connectors/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.operatorToken}` },
    // 只上传公钥：平台不会、也无法拿到节点私钥（D-MDOP-3）
    body: JSON.stringify({
      connectorId: input.connectorId ?? input.participantId,
      participantId: input.participantId,
      subjectPublicKey: input.publicKey,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`节点注册失败：HTTP ${res.status} ${text}`);
  const body = JSON.parse(text) as { certificate?: { fingerprint?: string } };
  return {
    fingerprint: body.certificate?.fingerprint ?? '',
    warnedAboutPrivateKey: Object.prototype.hasOwnProperty.call(body, 'privateKey'),
  };
}

/** 心跳请求头：与连接器同一口径（平台侧 `ConnectorTokenGuard.verifyRequest`）。 */
export function heartbeatHeaders(input: {
  participantId: string;
  certFingerprint: string;
  privateKey: string;
  body: Record<string, unknown>;
  now?: number;
}): Record<string, string> {
  const timestamp = String(input.now ?? Date.now());
  const bodySm3 = sm3Hex(stableStringify(input.body));
  return {
    'Content-Type': 'application/json',
    'X-Connector-Participant': input.participantId,
    'X-Connector-Cert-Fingerprint': input.certFingerprint,
    'X-Connector-Timestamp': timestamp,
    // 签名覆盖请求体：经过代理被改即验签失败
    'X-Connector-Signature': signSm2(`${timestamp}:${input.participantId}:${bodySm3}`, input.privateKey),
  };
}

export async function sendNodeHeartbeat(input: {
  baseUrl: string;
  participantId: string;
  certFingerprint: string;
  privateKey: string;
  /** 能力通告（由 `nodeCapabilityAdvertisement` 真跑证明得出）。 */
  advertisement: Record<string, unknown>;
  version?: string;
  resources?: Record<string, unknown>;
  now?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!input.certFingerprint)
    throw new Error('未配置节点证书指纹（TEE_NODE_CERT_FINGERPRINT）：无法通过出站认证');
  const body = {
    version: input.version ?? '1.0.0',
    ...(input.resources ? { resources: input.resources } : {}),
    mdop: input.advertisement,
  };
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl(`${input.baseUrl.replace(/\/$/, '')}/connector/heartbeat`, {
    method: 'POST',
    headers: heartbeatHeaders({
      participantId: input.participantId,
      certFingerprint: input.certFingerprint,
      privateKey: input.privateKey,
      body,
      ...(input.now !== undefined ? { now: input.now } : {}),
    }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`节点心跳失败：HTTP ${res.status} ${text}`);
  }
}
