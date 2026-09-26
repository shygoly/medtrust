import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  ENVELOPE_EXPORT_MODES,
  MdopError,
  assertEnvelopeBinding,
  canonicalize,
  parseDataEnvelope,
  sm2Verify,
  type DataEnvelope,
} from '@medtrust/mdop';

/**
 * 可信空间节点的**入口守卫**（任务 3.4）。
 *
 * 节点收到 C2 信封后、**解密之前**要逐项核对。这里的判据全部来自**信封自带的内容与本地合约条款**，
 * 不采信任何随消息而来的「它可信」声明。任何一条不过即拒收并留痕——不留「先解密再检查」的余地。
 *
 * 与其它两处判定的分工（三处不可互相替代）：
 *  - **本守卫**：信封本身合规吗？（形状 / AAD 绑定 / 签名 / 策略 / 有效期 / 切片范围）
 *  - **KMS**：这次会话的证明对不对？（quote 校验 → 释放密钥）
 *  - **出口守卫**：出去的东西是不是 C3？（发布审查后的制品）
 */

export interface EntryGuardInput {
  /** 原始信封对象（尚未解密）。 */
  rawEnvelope: unknown;
  /** 本节点标识（URN）。 */
  selfNode: string;
  /** 本次投递所属的作业上下文。 */
  expect: { job_id: string; credential_id: string; contract_id: string };
  /** 本地合约条款（读自本地副本；`allowed_ops` / `attestation_policy` / `data_product_id` 都从这里来）。 */
  contract: {
    contract_id: string;
    data_product_id: string;
    allowed_ops?: string[];
    attestation_policy?: { tee: string[] };
  };
  /** 本节点实际提供者的链型（由证明提供者告知；软件实现为 `null`）。 */
  providerKind: string | null;
  now?: Date;
}

export interface EntryDecision {
  envelope: DataEnvelope;
  /** 信封声明的数据产品 id（节点据此取本地切片做对拍）。 */
  dataProductId: string;
}

@Injectable()
export class TrustedNodeEntryGuard {
  private readonly logger = new Logger(TrustedNodeEntryGuard.name);
  private readonly violations: Array<{ at: string; reason: string; contractId: string }> = [];

  /** 逐项核对；通过则返回已解析的信封。 */
  check(input: EntryGuardInput): EntryDecision {
    const envelope = this.parse(input);
    this.assertBinding(envelope, input);
    this.assertPolicy(envelope, input);
    this.assertFreshness(envelope, input.now ?? new Date());
    this.assertOrigin(envelope, input);
    return { envelope, dataProductId: input.contract.data_product_id };
  }

  private parse(input: EntryGuardInput): DataEnvelope {
    try {
      return parseDataEnvelope(input.rawEnvelope);
    } catch (err) {
      this.reject(input, `信封结构非法：${(err as Error).message}`);
      throw new MdopError('E_ENVELOPE_POLICY', {}, '数据信封结构非法');
    }
  }

  private assertBinding(envelope: DataEnvelope, input: EntryGuardInput): void {
    try {
      assertEnvelopeBinding(envelope, input.expect);
    } catch (err) {
      this.reject(input, `信封绑定不符：${(err as Error).message}`);
      throw err;
    }
  }

  private assertPolicy(envelope: DataEnvelope, input: EntryGuardInput): void {
    // ① 出口形态：本期只允许 C3
    if (!(ENVELOPE_EXPORT_MODES as readonly string[]).includes(envelope.policy.export)) {
      this.reject(input, `出口形态不被允许：${envelope.policy.export}`);
      throw new MdopError('E_ENVELOPE_POLICY', {}, '信封的出口形态不被允许');
    }
    // ② 信封策略里的合约必须与本节点持有的合约副本一致（防「拿 A 合约的信封投 B 合约」）
    if (envelope.policy.contract !== input.contract.contract_id) {
      this.reject(input, '信封策略里的合约与本地副本不一致');
      throw new MdopError('E_ENVELOPE_POLICY', {}, '信封策略里的合约与本地副本不一致');
    }
    // ③ 本节点的证明链型必须在合约允许范围内——**这条是拿本节点实际提供者去比**，
    //    不是拿信封里写的清单自证（信封可以自称任何链型）
    const allowed = input.contract.attestation_policy?.tee ?? [];
    if (!input.providerKind || !allowed.includes(input.providerKind)) {
      this.reject(input, `本节点链型 ${input.providerKind ?? '（软件实现）'} 不在合约允许范围内`);
      throw new MdopError('E_CAPABILITY_MISMATCH', {}, '本节点的证明链型不在合约允许范围内');
    }
    // ④ 信封策略允许的算子必须覆盖本地合约允许的算子（收窄可以，放宽不行）
    const local = new Set(input.contract.allowed_ops ?? []);
    const declared = new Set(envelope.policy.allowed_ops);
    for (const op of local)
      if (!declared.has(op)) {
        this.reject(input, `信封策略未覆盖本地合约允许的算子：${op}`);
        throw new MdopError('E_ENVELOPE_POLICY', {}, '信封策略未覆盖本地合约允许的算子');
      }
  }

  private assertFreshness(envelope: DataEnvelope, now: Date): void {
    const until = Date.parse(envelope.policy.not_after);
    if (!Number.isFinite(until) || until <= now.getTime()) {
      this.reject({ contract: { contract_id: envelope.policy.contract } } as EntryGuardInput, '信封已过期');
      throw new MdopError('E_ENVELOPE_POLICY', {}, '信封已过期');
    }
  }

  /**
   * 持有方签名：对**去掉 `origin_sig` 的信封**规范化后验签。
   *
   * 公钥来源由调用方（节点）提供——通常是该持有方的登记证书；本守卫只做「内容与签名一致」这一步，
   * 不负责判断持有方是否有权投递（那是合约接收方列表与 KMS 的事）。
   */
  private assertOrigin(envelope: DataEnvelope, input: EntryGuardInput): void {
    const { origin_sig: sig, ...unsigned } = envelope;
    const publicKey = this.publicKeyFor(sig.signer);
    if (!publicKey) {
      this.reject(input, `没有该持有方的登记公钥：${sig.signer}`);
      throw new MdopError('E_AUTH_INVALID', {}, '没有信封签署方的登记公钥');
    }
    if (!sm2Verify(canonicalize(unsigned), sig.value, publicKey)) {
      this.reject(input, '信封的持有方签名无效');
      throw new MdopError('E_AUTH_INVALID', {}, '信封的持有方签名无效');
    }
  }

  /** 持有方公钥查询（由节点注入；缺省无 → 一律拒，fail-closed）。 */
  private publicKeyFor(signer: string): string | undefined {
    return this.holderKeys?.get(signer);
  }

  /** 违规留痕（审计导出用）。 */
  violationsLog(): ReadonlyArray<{ at: string; reason: string; contractId: string }> {
    return this.violations;
  }

  private reject(input: EntryGuardInput, reason: string): void {
    this.violations.push({
      at: new Date().toISOString(),
      reason,
      contractId: input.contract?.contract_id ?? '',
    });
    this.logger.warn(`[节点入口守卫] 拒收：${reason}`);
  }

  /** 供装配方注入持有方公钥表（测试与运行期各一份实现）。 */
  private readonly holderKeys?: Map<string, string>;

  constructor(@Optional() holderKeys?: Map<string, string>) {
    this.holderKeys = holderKeys;
  }
}
