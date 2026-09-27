import { canonicalSm3 } from "../crypto/sm3";
import { sm2Sign, sm2Verify } from "../crypto/sm2";
import { MdopError } from "../errors";

/**
 * 算子执行轨迹步骤（服务计算：交付即验证的状态机记录）。
 */
export interface ExecutionTraceStep {
  step_index: number;
  stage_id: string;
  op: string;
  op_digest: string;
  input_digest: string;
  output_digest: string;
  params_digest: string;
  label: "C0_internal" | "C3";
}

/**
 * 完整执行轨迹见证凭单。
 */
export interface ExecutionTraceWitness {
  version: "medtrust.trace/1.0";
  job_id: string;
  contract_id: string;
  node: string;
  trace_root: string;
  result_digest: string;
  step_count: number;
  created_at: string;
  sig: {
    alg: "SM2-SM3";
    kid: string;
    value: string;
  };
}

/**
 * 计算单个执行步骤的叶子哈希。
 */
export function computeStepLeafHash(step: ExecutionTraceStep): string {
  const leafPayload = {
    step_index: step.step_index,
    stage_id: step.stage_id,
    op: step.op,
    op_digest: step.op_digest,
    input_digest: step.input_digest,
    output_digest: step.output_digest,
    params_digest: step.params_digest,
    label: step.label,
  };
  return canonicalSm3(leafPayload);
}

/**
 * 计算步骤序列的 Merkle 根哈希。
 */
export function computeTraceMerkleRoot(steps: readonly ExecutionTraceStep[]): string {
  if (steps.length === 0) {
    return canonicalSm3({ empty: true });
  }

  let currentLevel = steps.map(computeStepLeafHash);

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      const combined = canonicalSm3({ left, right });
      nextLevel.push(combined);
    }
    currentLevel = nextLevel;
  }

  return currentLevel[0];
}

/**
 * 生成执行轨迹见证签名凭证。
 */
export function generateTraceWitness(input: {
  jobId: string;
  contractId: string;
  node: string;
  steps: readonly ExecutionTraceStep[];
  resultDigest: string;
  privateKey: string;
  publicKeyKid: string;
  now?: Date;
}): ExecutionTraceWitness {
  const traceRoot = computeTraceMerkleRoot(input.steps);
  const createdAt = (input.now ?? new Date()).toISOString();

  const bodyToSign = {
    version: "medtrust.trace/1.0" as const,
    job_id: input.jobId,
    contract_id: input.contractId,
    node: input.node,
    trace_root: traceRoot,
    result_digest: input.resultDigest,
    step_count: input.steps.length,
    created_at: createdAt,
  };

  const signature = sm2Sign(canonicalSm3(bodyToSign), input.privateKey);

  return {
    ...bodyToSign,
    sig: {
      alg: "SM2-SM3",
      kid: input.publicKeyKid,
      value: signature,
    },
  };
}

/**
 * 校验执行轨迹见证凭单的完整性与真实性。
 */
export function verifyTraceWitness(
  witness: ExecutionTraceWitness,
  publicKey: string,
): boolean {
  if (witness.version !== "medtrust.trace/1.0") return false;

  const bodyToVerify = {
    version: witness.version,
    job_id: witness.job_id,
    contract_id: witness.contract_id,
    node: witness.node,
    trace_root: witness.trace_root,
    result_digest: witness.result_digest,
    step_count: witness.step_count,
    created_at: witness.created_at,
  };

  return sm2Verify(canonicalSm3(bodyToVerify), witness.sig.value, publicKey);
}
