import {
  MdopError,
  parseKeyReleaseWarrant,
  type KeyReleaseRequest,
  type KeyReleaseWarrant,
  type KmsClient,
} from '@medtrust/mdop';
import { signSm2 } from '../domain/sm2-sign';
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
}

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
    const res = await (this.opts.fetchImpl ?? fetch)(this.opts.url, {
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
    });
    if (!res.ok)
      throw new MdopError('E_KEY_RELEASE_DENIED', input.where ?? {}, `密钥保管方不可用：HTTP ${res.status}`);
    const body = (await res.json()) as { released?: unknown; warrant?: unknown; detail?: unknown };
    if (body.released !== true)
      throw new MdopError(
        'E_KEY_RELEASE_DENIED',
        input.where ?? {},
        `密钥保管方拒绝释放：${typeof body.detail === 'string' ? body.detail : '未说明'}`,
      );
    return parseKeyReleaseWarrant(body.warrant);
  }
}
