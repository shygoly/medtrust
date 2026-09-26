import { MdopError, verifyEnvelope, type Envelope } from '@medtrust/mdop';
import { signSm2 } from '../domain/sm2-sign';

/**
 * 节点的**长轮询派发**（任务 3.14 的最后一处接线）。
 *
 * 节点与数据持有方一样**只出站**：用自己登记证书的签名头去拉 `/connector/tasks/pending`，
 * 平台把发件箱里给它的消息（含 `C2EnvelopeRelay`）随批次下发。取回后：
 *  ① 逐封**验签 + 收件人 + 时间窗**（公钥是部署配置里的平台节点公钥，MUST NOT 取自消息）；
 *  ② 按 `msg_id` **去重**（平台是至少一次投递，重发很常见）；
 *  ③ 只把 `C2EnvelopeRelay` 交给调用方处理，其余类型如实记为「收到但本组件暂无处理器」。
 *
 * 去重是**内存态**：重启后同一封可能再被处理一次。这不改变正确性——
 * 会话的制品句柄与 C3 投递幂等键都由「作业 + 阶段 + 凭证」决定，平台侧按幂等键去重；
 * 但重启后重跑会**再释放一次密钥**（新凭据），因此这条边界要如实记在文档里。
 */

export interface NodePollerDeps {
  baseUrl: string;
  /** 本节点参与方 id 与其自持私钥（签名头用）。 */
  participantId: string;
  privateKey: string;
  /** 平台 CA 签发的节点证书指纹（注册时登记的那个）。 */
  certFingerprint: string;
  /** 平台节点公钥（部署配置）：验证平台下发的信封。 */
  platformPublicKey: string;
  /** 本节点 URN（收件人校验）。 */
  self: string;
  fetchImpl?: typeof fetch;
  /** 已处理过的 msg_id（内存态去重）。 */
  processed?: Set<string>;
}

export interface NodeInboundMessage {
  envelope: Envelope;
  /** 消息 body（原样交给 `NodeMessageRouter`；各类型的判据在路由器里，不在这里）。 */
  body: Record<string, unknown>;
}

export interface PollOutcome {
  /** 本组件的入站消息（要约/凭证/C2 中继/阶段派发/销毁指令）。 */
  messages: NodeInboundMessage[];
  /**
   * 平台随批次下发的**算子清单**（注册中心签名）与**吊销名单**（平台节点签名）。
   * 本组件只搬运：验签与采纳由 `operator-store` 按部署配置里的公钥做（fail-closed）。
   */
  mdopOperators?: Array<{
    ref: string;
    digest: string;
    manifest: unknown;
    signature: unknown;
  }>;
  mdopRevocations?: unknown;
  /** 收到但本组件暂无处理器的消息类型（如实列出，不静默丢）。 */
  ignored: Array<{ msgId: string; msgType: string }>;
  /** 验签/收件人/时间窗不过的消息（不处理、留痕）。 */
  rejected: Array<{ msgId: string; reason: string }>;
  /** 因 msg_id 重复而跳过的条数。 */
  duplicates: number;
}

/**
 * 平台→节点信道的消息类型（其余类型不归本组件处理）。
 *
 * 五类都是**节点作为一等参与方**必须处理的：少了要约/凭证，作业拿不到凭证（平台的
 * `holderNodes` 含全部片段节点）；少了销毁指令，作业永远进不了 `PURGED`。
 */
export const NODE_INBOUND_TYPES = [
  'PlanFragmentOffer',
  'ExecutionTicketIssue',
  'C2EnvelopeRelay',
  'StageDispatch',
  'PurgeOrder',
] as const;

function authHeaders(deps: NodePollerDeps, now: number): Record<string, string> {
  const timestamp = String(now);
  return {
    Accept: 'application/json',
    'X-Connector-Participant': deps.participantId,
    'X-Connector-Cert-Fingerprint': deps.certFingerprint,
    'X-Connector-Timestamp': timestamp,
    // GET 不带请求体：签名内容 = ts:pid（与平台侧 verifyRequest 同规则）
    'X-Connector-Signature': signSm2(`${timestamp}:${deps.participantId}`, deps.privateKey),
  };
}

/**
 * 拉一次批次并把给本节点的消息分发出来。`waitMs` 走平台的长轮询上限（服务端硬上限 25s）。
 */
export async function pollNodeMessages(
  deps: NodePollerDeps,
  opts: { waitMs?: number; now?: number } = {},
): Promise<PollOutcome> {
  if (!deps.platformPublicKey)
    throw new MdopError('E_AUTH_INVALID', {}, '未配置平台公钥（TEE_NODE_PLATFORM_PUBKEY），不得处理平台下发消息');
  if (!deps.certFingerprint)
    throw new MdopError('E_AUTH_INVALID', {}, '未配置节点证书指纹（TEE_NODE_CERT_FINGERPRINT），无法通过出站认证');
  const fetchImpl = deps.fetchImpl ?? fetch;
  const waitMs = Math.max(0, Math.floor(opts.waitMs ?? 25_000));
  const url = `${deps.baseUrl.replace(/\/$/, '')}/connector/tasks/pending?waitMs=${waitMs}`;
  const res = await fetchImpl(url, { method: 'GET', headers: authHeaders(deps, opts.now ?? Date.now()) });
  if (!res.ok) throw new MdopError('E_RUNTIME', {}, `节点长轮询失败：HTTP ${res.status}`);
  const batch = (await res.json()) as { mdop?: Envelope[] };

  const processed = deps.processed ?? new Set<string>();
  const outcome: PollOutcome = {
    messages: [],
    ignored: [],
    rejected: [],
    duplicates: 0,
    ...(Array.isArray((batch as { mdopOperators?: unknown }).mdopOperators)
      ? { mdopOperators: (batch as { mdopOperators: PollOutcome['mdopOperators'] }).mdopOperators }
      : {}),
    ...((batch as { mdopRevocations?: unknown }).mdopRevocations !== undefined
      ? { mdopRevocations: (batch as { mdopRevocations?: unknown }).mdopRevocations }
      : {}),
  };

  for (const envelope of batch.mdop ?? []) {
    if (processed.has(envelope.msg_id)) {
      outcome.duplicates += 1;
      continue;
    }
    try {
      // 平台公钥来自部署配置；收件人必须是本节点；时间窗与签名由 verifyEnvelope 判。
      //
      // **这里刻意不启用 nonce 表**（与连接器侧不同，连接器用持久 nonce 表），理由是三条覆盖已足够：
      //  ① 消息**只能来自被 pin 的平台公钥**（`platformPublicKey` 来自部署配置，不取自消息）；
      //  ② 原样重放：`msg_id` 在**落盘去重表**里（TTL 24h），同 id 直接跳过；
      //  ③ 改了任何字段（含 `msg_id`）重放：签名验不过；而超过时间窗的旧封存件也被 `verifyEnvelope` 拒。
      // 换句话说，nonce 表在这一侧是冗余的；但**如果哪天允许「非平台方」发消息给节点**，
      // 这条推理就不成立——那时必须把 nonce 表接上（`rememberNonce` 也要置真）。
      verifyEnvelope(envelope, {
        self: deps.self,
        senderPublicKey: deps.platformPublicKey,
        nonceStore: { seen: () => false, remember: () => undefined },
        rememberNonce: false,
      });
    } catch (err) {
      // 验不过的消息**不处理**，但要留痕（含 msg_id 与原因），便于平台侧排查下发内容
      outcome.rejected.push({ msgId: envelope.msg_id, reason: (err as Error).message });
      continue;
    }
    processed.add(envelope.msg_id);

    if ((NODE_INBOUND_TYPES as readonly string[]).includes(envelope.msg_type))
      outcome.messages.push({ envelope, body: (envelope.body ?? {}) as Record<string, unknown> });
    else outcome.ignored.push({ msgId: envelope.msg_id, msgType: envelope.msg_type });
  }
  return outcome;
}

/**
 * 把取回的消息逐条交给处理器（生产装配里就是 `NodeMessageRouter.handle`）。
 * 一条失败不影响其余条目——失败原因逐条返回，由调用方决定重试与上报。
 */
export async function dispatchNodeMessages(
  messages: readonly NodeInboundMessage[],
  handler: (message: NodeInboundMessage) => Promise<unknown>,
): Promise<Array<{ msgId: string; ok: boolean; detail?: string }>> {
  const results: Array<{ msgId: string; ok: boolean; detail?: string }> = [];
  for (const message of messages) {
    try {
      await handler(message);
      results.push({ msgId: message.envelope.msg_id, ok: true });
    } catch (err) {
      results.push({ msgId: message.envelope.msg_id, ok: false, detail: (err as Error).message });
    }
  }
  return results;
}

/** 节点轮询相关配置（逐个键 `process.env.<KEY>` 直读：与部署登记表双向对拍）。 */
export function nodePollerEnv(): { certFingerprint: string; platformPublicKey: string } {
  return {
    certFingerprint: (process.env.TEE_NODE_CERT_FINGERPRINT ?? '').trim(),
    platformPublicKey: (process.env.TEE_NODE_PLATFORM_PUBKEY ?? '').trim(),
  };
}
