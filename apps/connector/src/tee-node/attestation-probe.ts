import {
  MdopError,
  verifyEndorsementPush,
  type AttestationProvider,
  type AttestationReport,
} from '@medtrust/mdop';
import { signSm2 } from '../domain/sm2-sign';

/**
 * 节点侧**证明探针**（任务 5.9 / 决策 D-TEE-6）。
 *
 * 背景：编译期放置 C2 要求本节点有一份**未过期**的证明登记，而节点自己的会话见证要等一次
 * **作业绑定**的 KMS 密钥释放——「先有鸡还是先有蛋」。因此需要一个**作业之前**的动作：
 *
 *   节点真跑一次证明 → 交给校验方（KMS / 证明服务）验 quote → 校验方对证明摘要签名背书
 *   → 校验方把背书推给平台登记（部署侧接口，平台不自己验 quote）
 *
 * 本模块负责**节点这一半**，并且做一件容易被省略但很关键的事：**校验方回传的背书，节点自己验**——
 * 验签用部署配置的校验方公钥，还要核对背书里的 `node` 与 `quote_digest` **就是本次这份证明**。
 * 否则「它说验过了」就成了一句无法核对的转述，而节点是有能力核对它的。
 *
 * 三条边界：
 *  - 软件提供者的报告**不送**（拿不到背书是设计意图，不是故障）；
 *  - 探针地址由部署侧给定，**不设默认值**（默认值会把证明送错地方）；
 *  - 探针**不等于**「C2 可用」：它只把「这次证明被校验方看过」变成可核验的事实。
 */

export interface AttestationProbeDeps {
  /** 本节点 URN（证明里的身份绑定要与它一致）。 */
  node: string;
  /** 参与方 id（出站签名头用，与长轮询同一套认证口径）。 */
  participantId: string;
  /** 本节点自持私钥（对 `ts:pid` 签名，证明「是我在探针」）。 */
  privateKey: string;
  provider: AttestationProvider;
  /** 校验方的证明服务地址（部署侧给定；**不给默认值**）。 */
  verifierUrl: string;
  /** 校验方公钥（部署配置）：核验它回传的背书。 */
  kmsPublicKey: string;
  /** 允许的校验方标识（部署白名单）；给了就要求背书里的 `verifier` 在内。 */
  trustedVerifiers?: readonly string[];
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface AttestationProbeOutcome {
  /** 本次证明报告（调用方可留档；**不含**任何密钥材料）。 */
  report: AttestationReport;
  /** 校验方是否接受（HTTP 200 且 `accepted: true`）。 */
  accepted: boolean;
  /** 是否**验证过**校验方回传的背书（true 表示已验签且绑定到本次证明）。 */
  endorsed: boolean;
  /** 背书有效期（校验方给的口径）。 */
  expiresAt?: string;
  detail?: string;
}

export async function runAttestationProbe(
  deps: AttestationProbeDeps,
): Promise<AttestationProbeOutcome> {
  if (!deps.verifierUrl)
    throw new MdopError('E_RUNTIME', {}, '未配置校验方探针地址：不得把证明送到未指定的地方');
  const report = await deps.provider.prove();
  if (report.level !== 'hardware' || report.isolation !== 'hardware-enclave')
    throw new MdopError(
      'E_ATTESTATION_FAILED',
      { node: deps.node },
      '软件实现不得作为 C2 目标：不申请证明背书',
    );

  const now = deps.now?.() ?? new Date();
  const timestamp = String(now.getTime());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(deps.verifierUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      // 与长轮询同一套认证口径：签名内容 = ts:pid（校验方据此认「是哪个节点在探针」）
      'X-Connector-Participant': deps.participantId,
      'X-Connector-Timestamp': timestamp,
      'X-Connector-Signature': signSm2(`${timestamp}:${deps.participantId}`, deps.privateKey),
    },
    body: JSON.stringify({ node: deps.node, report }),
  });
  if (!res.ok) throw new MdopError('E_RUNTIME', {}, `证明探针失败：HTTP ${res.status}`);
  const body = (await res.json()) as {
    accepted?: unknown;
    endorsement?: unknown;
    detail?: unknown;
  };
  if (body.accepted !== true)
    return {
      report,
      accepted: false,
      endorsed: false,
      ...(typeof body.detail === 'string' ? { detail: body.detail } : {}),
    };

  // 校验方说「接受」之后，**它回传的背书必须自己验**：验签 + 必须是给本次这份证明的
  if (body.endorsement === undefined)
    return { report, accepted: true, endorsed: false, detail: 'no-endorsement-returned' };
  const { endorsement } = verifyEndorsementPush({
    push: body.endorsement,
    verifierPublicKey: deps.kmsPublicKey,
    ...(deps.trustedVerifiers ? { trustedVerifiers: deps.trustedVerifiers } : {}),
    now,
  });
  if (endorsement.node !== deps.node)
    throw new MdopError(
      'E_ATTESTATION_FAILED',
      { node: deps.node },
      `校验方回传的背书是别的节点的（${endorsement.node}）`,
    );
  if (endorsement.quoteDigest !== report.quote_digest)
    throw new MdopError(
      'E_ATTESTATION_FAILED',
      { node: deps.node },
      '校验方回传的背书不是本次这份证明（quote 摘要不符）',
    );
  return { report, accepted: true, endorsed: true, expiresAt: endorsement.expiresAt };
}
