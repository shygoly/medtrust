import { Injectable, Logger } from '@nestjs/common';
import {
  MdopError,
  verifySessionWitness,
  type AttestationExpectation,
  type AttestationPolicy,
  type SessionWitness,
} from '@medtrust/mdop';

/**
 * 持有方侧的**会话见证独立核验**（任务 6.7 / D13）。
 *
 * 这是 D13 选的机制落点：持有方不采信「平台说这份证明验过了」，而是拿**KMS 释放凭据**
 * 自己验——验签用的公钥来自**部署配置**（`kmsPublicKey`，MUST NOT 取自消息），
 * 因此平台能「不给」，但做不到「伪造」。
 *
 * 与另外两处判定的分工（三处不可互相替代）：
 *  - 复核第 4 项：**执行前**判「合约有没有证明策略、对端是不是合约参与方」——那时本次会话的证明还不存在；
 *  - 本类：**会话后**判「这次会话确实发生在被批准的那份代码下，且 KMS 确实为该会话释放过密钥」；
 *  - 出口守卫：判「本次证明的**声明**是否满足策略」（quote 的真实性由释放凭据背书）。
 *
 * 结论**必须留痕**：通过写 `WITNESS_VERIFIED`，拒绝写 `WITNESS_REJECTED`（含错误码），
 * 两者都会进审计回执链——「验过没有」是可查事实，不是日志里的一句话。
 */

export interface WitnessVerificationRecord {
  job_id: string;
  node: string;
  verified: boolean;
  /** 通过时为释放凭据摘要；拒绝时为 null。 */
  warrant_digest: string | null;
  /**
   * 拒绝时的**错误码**（通过时为 null）。
   *
   * 为什么必须是独立字段而不是只塞进 `reason`：回执要按码统计与告警（「这批拒绝全是
   * `E_KEY_RELEASE_DENIED`」与「全是 `E_MEASUREMENT_NOT_ALLOWED`」是两件事），
   * 把一个字符串当结构化数据用，下游只能靠解析自然语言（本册反复吃过的亏）。
   */
  code: string | null;
  /** 拒绝原因（错误码 + 说明）；通过时为 null。 */
  reason: string | null;
  measurement: string | null;
  tcb: string | null;
  at: string;
}

@Injectable()
export class NodeWitnessVerifier {
  private readonly logger = new Logger(NodeWitnessVerifier.name);
  private readonly records: WitnessVerificationRecord[] = [];

  constructor(
    private readonly deps: {
      /** **部署配置**里的 KMS 公钥（未配置即一律拒，fail-closed）。 */
      kmsPublicKey: string;
      now?: () => Date;
    },
  ) {}

  /**
   * 核验一份会话见证。**不抛错**：返回判定结果，由调用方（连接器运行时）把它写成审计回执——
   * 拒绝也要留痕，不能静默丢弃（至少一次投递会把同一条消息再送一次，靠留痕而非抛错来收口）。
   */
  verify(input: {
    witness: SessionWitness;
    policy: AttestationPolicy;
    expectation?: AttestationExpectation;
  }): WitnessVerificationRecord {
    const now = this.deps.now?.() ?? new Date();
    const base = {
      job_id: input.witness.job_id,
      node: input.witness.node,
      measurement: input.witness.report.measurement,
      tcb: input.witness.report.tcb,
      at: now.toISOString(),
    };
    try {
      if (!this.deps.kmsPublicKey)
        throw new MdopError(
          'E_KEY_RELEASE_DENIED',
          {},
          '本节点未配置 KMS 公钥（持有方侧独立核验的前提，MUST 来自部署配置）',
        );
      const { session } = verifySessionWitness({
        witness: input.witness,
        kmsPublicKey: this.deps.kmsPublicKey,
        policy: input.policy,
        ...(input.expectation ? { expectation: input.expectation } : {}),
        now,
      });
      const record: WitnessVerificationRecord = {
        ...base,
        verified: true,
        warrant_digest: session.digest,
        code: null,
        reason: null,
      };
      this.records.push(record);
      this.logger.log(
        `会话见证核验通过 job=${record.job_id} node=${record.node} warrant=${session.digest.slice(0, 16)}…`,
      );
      return record;
    } catch (err) {
      const code = err instanceof MdopError ? err.code : 'E_RUNTIME';
      const record: WitnessVerificationRecord = {
        ...base,
        verified: false,
        warrant_digest: null,
        code,
        reason: `${code}: ${(err as Error).message}`,
      };
      this.records.push(record);
      // 拒绝也留痕：这条日志和上面那条**不是**同一件事，别把它们合并成「一条 info」
      this.logger.warn(`会话见证核验失败 job=${record.job_id} node=${record.node}：${record.reason}`);
      return record;
    }
  }

  /** 本节点核验过的见证（审计导出用；与回执链同源）。 */
  recordsLog(): readonly WitnessVerificationRecord[] {
    return this.records;
  }
}
