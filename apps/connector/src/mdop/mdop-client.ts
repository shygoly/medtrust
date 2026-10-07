import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  assertNoInlineArtifact,
  parseParticipantUrn,
  signEnvelope,
  type Envelope,
  type MdopMessageType,
  type UnsignedEnvelope,
} from '@medtrust/mdop';
import { loadConnectorPrivateKey, connectorPublicKey } from '../domain/connector-key';
import { withHttpDeadline } from './http-deadline';

/**
 * 出站请求的总时限（缺省 60 秒，覆盖读响应体）。
 *
 * 连接器与可信空间节点都**串行**处置消息：一条出站请求不返回，后面的要约、派发、销毁全都排不上。
 * 最大的一类是 C2 信封中继（请求体上限 2MB）——60 秒对应约 35KB/s 的下限速率。
 * 超时即抛出，按各调用点既有的失败路径处理（阶段失败上报 / 消息留待平台重发）。
 */
export const MDOP_OUTBOUND_TIMEOUT_MS = 60_000;

/**
 * 平台**明确应答了**一个非 2xx：与「链路不通 / 超时」是两回事——前者是平台的结论，
 * 再发一遍同样的内容多半还是同一个结论；后者只是没送到。调用方据此区分「待重发」与「被拒」。
 * `platformCode` 是平台应答体里的协议错误码（`E_*`，有就带上；没有就是普通的 4xx/5xx）。
 * 文案沿用既有口径（日志与用例都按它匹配）。
 */
export class MdopOutboundHttpError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly platformCode?: string,
  ) {
    super(`MDOP 出站失败 ${path}: HTTP ${status}`);
    this.name = 'MdopOutboundHttpError';
  }
}

function platformCodeOf(text: string): string | undefined {
  try {
    const code = (JSON.parse(text) as { code?: unknown } | null)?.code;
    return typeof code === 'string' && /^E_[A-Z_]+$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 连接器 → 平台的**出站**客户端（任务 8.2 / D3）。
 *
 * 两个独立出口，便于分别审计「哪些接口携带数据」：
 *  - 控制面 `POST /api/v1/mdop/messages`：接受/拒绝、合约签署、阶段状态、制品就绪、
 *    销毁回执、审计回执、能力通告 —— **不得携带制品内容**；
 *  - 数据面 `POST /api/v1/mdop/deliveries`：只承载 C3 结果投递。
 *
 * 信封用**本院私钥**签名（国标 SM2），平台用登记证书公钥验签。
 * 连接器不为 MDOP 开放任何入站端口。
 */

export interface OutboundEnvelopeInput {
  msgType: MdopMessageType;
  jobId?: string;
  receiver: string;
  idempotencyKey: string;
  body: Record<string, unknown>;
  /** 覆盖 msg_id（重发时复用，保持幂等）。 */
  msgId?: string;
  nonce?: string;
}

@Injectable()
export class MdopOutboundClient {
  private readonly logger = new Logger(MdopOutboundClient.name);
  private readonly baseUrl: string;
  private readonly participantId: string;

  constructor(
    @Optional()
    opts?: {
      baseUrl?: string;
      participantId?: string;
      privateKey?: string;
      /** 单次出站请求的总时限（毫秒，缺省 {@link MDOP_OUTBOUND_TIMEOUT_MS}）。 */
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
    },
  ) {
    const o = opts ?? {};
    this.baseUrl = (
      o.baseUrl ??
      process.env.CONTROL_PLANE_URL ??
      'http://localhost:5021/api/v1'
    ).replace(/\/$/, '');
    this.participantId =
      o.participantId ?? process.env.CONNECTOR_PARTICIPANT_ID ?? '';
    this.privateKeyOverride = o.privateKey;
    this.timeoutMs = Math.max(1, o.timeoutMs ?? MDOP_OUTBOUND_TIMEOUT_MS);
    this.fetchImpl = o.fetchImpl;
  }

  private readonly privateKeyOverride?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;

  private privateKey(): string {
    const key = this.privateKeyOverride ?? loadConnectorPrivateKey();
    if (!key) throw new Error('未配置连接器私钥：无法签名出站消息（D-MDOP-3）');
    return key;
  }

  /** 本院节点标识（URN）。 */
  selfUrn(space = process.env.SPACE_ID ?? 'sh-med'): string {
    return `urn:tds:${space}:participant:${this.participantId}`;
  }

  /** 构造并签名一封出站信封（同一 msg_id/nonce 可重发）。 */
  buildEnvelope(input: OutboundEnvelopeInput): Envelope {
    const unsigned: UnsignedEnvelope = {
      mdop: '0.2',
      msg_id: input.msgId ?? randomUUID(),
      msg_type: input.msgType,
      job_id: input.jobId ?? '',
      sender: this.selfUrn(),
      receiver: input.receiver,
      timestamp: new Date().toISOString(),
      nonce: input.nonce ?? randomUUID(),
      idempotency_key: input.idempotencyKey,
      body: input.body,
    };
    const privateKey = this.privateKey();
    return signEnvelope(unsigned, privateKey, {
      publicKey: connectorPublicKey(privateKey),
    });
  }

  /** 控制面：不得携带制品内容（发送前本地先拦一道）。 */
  async sendMessage(envelope: Envelope): Promise<unknown> {
    const sender = parseParticipantUrn(envelope.sender);
    if (!sender) throw new Error('sender 不是参与方 URN');
    assertNoInlineArtifact(envelope.body ?? {}, 'control-plane');
    return this.post('/mdop/messages', { envelope });
  }

  /** 数据面：只承载 C3 结果投递。 */
  async sendDelivery(
    envelope: Envelope,
    handle: { handle: string; label: string; digest: string; stats?: unknown },
    /** C3 载荷：平台是合约明示的接收方（D-MDOP-2），合并要用它。 */
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.post('/mdop/deliveries', { envelope, handle, ...(payload ? { payload } : {}) });
  }

  /**
   * 数据面：**提交 C2 信封给平台中继**（任务 3.14 / design D15）。
   *
   * 平台在这条路上是**转运方**：它拿到密文与密钥封套（数据密钥封给目标节点会话的一次性公钥），
   * 按作业与合约策略校验后转给目标节点。平台解不开，因此这不是「把数据交给平台」。
   */
  async relayEnvelope(input: {
    envelope: Envelope;
    sealed: { ciphertext: string; iv: string; tag: string };
    /** 目标可信空间节点（参与方 URN），必须是该作业的片段节点。 */
    target: string;
  }): Promise<unknown> {
    return this.post('/mdop/envelopes', input);
  }

  /** 登记制品句柄（不含数据）。 */
  async registerHandle(handle: Record<string, unknown>): Promise<unknown> {
    return this.post('/mdop/handles', { handle });
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    // 整次请求（含读响应体）有总时限：卡住或滴流的响应到点中止，不让串行的消息循环挂死
    const res = await withHttpDeadline(`MDOP 出站 ${path} `, this.timeoutMs, async (signal) => {
      const response = await (this.fetchImpl ?? fetch)(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      return { ok: response.ok, status: response.status, text: await response.text() };
    });
    if (!res.ok) {
      this.logger.error(`MDOP 出站失败 ${path}: HTTP ${res.status} ${res.text}`);
      throw new MdopOutboundHttpError(path, res.status, platformCodeOf(res.text));
    }
    return res.text ? JSON.parse(res.text) : {};
  }
}
