import {
  MdopError,
  parseKeyReleaseWarrant,
  type KeyReleaseRequest,
  type KeyReleaseWarrant,
  type KmsClient,
} from '@medtrust/mdop';
import { signSm2 } from '../domain/sm2-sign';
import { HttpDeadlineError, withHttpDeadline } from '../mdop/http-deadline';
import type { QuoteEvidenceSource } from './attestation-probe';

/**
 * 远程 KMS 客户端（两处接缝里「KMS」那一处的真实实现，任务 3.3 / tdx-attestation-pilot 4.3）。
 *
 * 节点把「释放请求 + 本次证明的原生 quote」交给密钥保管方；保管方自己验 quote、自己判释放，
 * 回一份用证明里的一次性公钥封好的数据密钥与签名凭据。**节点不参与判定**——它只是请求方：
 *  - 认证口径与证明探针相同（`ts:pid` 的 SM2 签名头）；
 *  - quote 原文放在请求体的 `evidence` 里随行（协议层的 `KeyReleaseRequest` 只带摘要）；
 *  - 回来的凭据是不受信输入：严格解析后交回会话，由会话用**部署配置的 KMS 公钥**核验。
 * 被拒即抛 `E_KEY_RELEASE_DENIED`，不重试、不回退。
 */
export interface HttpKmsClientOptions {
  kmsRef: string;
  /** 密钥释放地址（部署侧给定；不设默认值）。 */
  url: string;
  participantId: string;
  privateKey: string;
  evidence: QuoteEvidenceSource;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** 释放请求的总时限（毫秒，缺省 {@link KMS_RELEASE_TIMEOUT_MS}）。 */
  timeoutMs?: number;
}

/** 密钥释放请求的总时限（缺省 30 秒，覆盖读响应体）。 */
export const KMS_RELEASE_TIMEOUT_MS = 30_000;

export class HttpKmsClient implements KmsClient {
  readonly kmsRef: string;

  constructor(private readonly opts: HttpKmsClientOptions) {
    if (!opts.url) throw new MdopError('E_RUNTIME', {}, '未配置密钥释放地址（TEE_NODE_KMS_URL）');
    this.kmsRef = opts.kmsRef;
  }

  async requestRelease(input: KeyReleaseRequest): Promise<KeyReleaseWarrant> {
    const digest = input.report.quote_digest;
    const quote = digest ? this.opts.evidence.evidenceFor(digest) : undefined;
    if (!quote)
      throw new MdopError(
        'E_KEY_RELEASE_DENIED',
        input.where ?? {},
        '拿不到本次证明的原生 quote，无法向密钥保管方举证',
      );

    const timestamp = String((this.opts.now?.() ?? new Date()).getTime());
    // 释放请求有总时限：保管方链路卡住时本阶段按**可重试**的 `E_TIMEOUT` 失败（平台退避重发），
    // 而不是让节点的串行循环挂在这里——那样节点对平台表现为静默，连心跳都发不出去。
    // 这不是「被拒」：保管方没有给出结论，不得报成 `E_KEY_RELEASE_DENIED`（不可重试）。
    let res: { ok: boolean; status: number; body: { released?: unknown; warrant?: unknown; detail?: unknown } | null };
    try {
      res = await withHttpDeadline(
        '密钥释放',
        Math.max(1, this.opts.timeoutMs ?? KMS_RELEASE_TIMEOUT_MS),
        async (signal) => {
          const response = await (this.opts.fetchImpl ?? fetch)(this.opts.url, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Connector-Participant': this.opts.participantId,
              'X-Connector-Timestamp': timestamp,
              'X-Connector-Signature': signSm2(
                `${timestamp}:${this.opts.participantId}`,
                this.opts.privateKey,
              ),
            },
            body: JSON.stringify({
              request: {
                key_id: input.key_id,
                context: input.context,
                report: input.report,
                policy: input.policy,
                credential_valid: input.credential_valid,
                contract_active: input.contract_active,
              },
              evidence: { quote },
            }),
            signal,
          });
          return {
            ok: response.ok,
            status: response.status,
            body: response.ok
              ? ((await response.json()) as { released?: unknown; warrant?: unknown; detail?: unknown })
              : null,
          };
        },
      );
    } catch (err) {
      if (err instanceof HttpDeadlineError)
        throw new MdopError(
          'E_TIMEOUT',
          input.where ?? {},
          `密钥保管方没有在时限内应答（${err.timeoutMs}ms）`,
        );
      throw err;
    }
    if (!res.ok || !res.body)
      throw new MdopError('E_KEY_RELEASE_DENIED', input.where ?? {}, `密钥保管方不可用：HTTP ${res.status}`);
    const body = res.body;
    if (body.released !== true)
      throw new MdopError(
        'E_KEY_RELEASE_DENIED',
        input.where ?? {},
        `密钥保管方拒绝释放：${typeof body.detail === 'string' ? body.detail : '未说明'}`,
      );
    return parseKeyReleaseWarrant(body.warrant);
  }
}
