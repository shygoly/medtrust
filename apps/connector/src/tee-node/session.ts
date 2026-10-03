import {
  MdopError,
  type AttestationReport,
  type KeyReleaseWarrant,
  type SessionWitness,
} from '@medtrust/mdop';
import type { C2SessionInput, C2SessionResult, C2StageResult } from '../mdop/node/node-session';
import { TrustedNodeSession } from '../mdop/node/node-session';

/**
 * 节点组件的会话入口（任务 3.11 的装配由组件侧负责）。
 *
 * 这里刻意**只做两件事**：跑一次 C2 会话，并为**每一次密钥释放**产出对应的会话见证
 * （证明报告 + KMS 释放凭据）。协议的判定、守卫、闸门、回执都在 `mdop/node/*` 里，
 * 组件不再复制一份——否则「同一件事两处实现」正是这套设计要避免的。
 *
 * 为什么一次会话可能有多条见证：每个封存输入有**自己的 `key_id` 与释放凭据**，
 * 而证明报告是会话级的。见证因此按「释放」切分：同一份证明 + 各自那份凭据，
 * 各自可独立验签（接收方不必理解「多输入」这件事）。
 */

export interface NodeSessionOutcome {
  result: C2SessionResult;
  /** 每个 `key_id` 一条见证（发往平台，再由平台转给持有方）。 */
  witnesses: SessionWitness[];
}

export async function runNodeSession(
  session: TrustedNodeSession,
  input: C2SessionInput,
): Promise<NodeSessionOutcome> {
  const result = await session.run(input);
  return { result, witnesses: buildWitnesses(result) };
}

/**
 * **只跑阶段、不出口**（两阶段路径的第一段）：产物留在节点本地，但仍要出见证——
 * 密钥**确实释放过**，持有方必须能自己验那一次释放，否则「配对阶段的解封」就成了无据可查的暗箱。
 */
export async function runNodeStage(
  session: TrustedNodeSession,
  input: C2SessionInput,
): Promise<{ stage: C2StageResult; witnesses: SessionWitness[] }> {
  const stage = await session.runStage(input);
  return { stage, witnesses: buildWitnesses(stage) };
}

/** 证据来源：会话结果与阶段结果都满足（`run()` 是 `runStage()` 的超集）。 */
export interface WitnessSource {
  jobId: string;
  credentialId: string;
  contractId: string;
  node: string;
  report?: AttestationReport;
  releases?: Array<{ key_id: string; warrant: KeyReleaseWarrant; contract_id?: string }>;
}

/** 由会话结果构造见证（每条释放一份）。 */
export function buildWitnesses(result: WitnessSource): SessionWitness[] {
  if (!result.report) throw new MdopError('E_RUNTIME', {}, '会话结果缺少证明报告，无法出见证');
  if (!result.releases || result.releases.length === 0)
    throw new MdopError('E_RUNTIME', {}, '会话结果没有任何密钥释放，无法出见证');
  return result.releases.map((release) => ({
    job_id: result.jobId,
    credential_id: result.credentialId,
    // 见证绑的是**这把密钥所属的合约**（多合约作业各不相同），不是会话合约
    contract_id: release.contract_id ?? result.contractId,
    key_id: release.key_id,
    node: result.node,
    report: result.report!,
    warrant: release.warrant,
  }));
}
