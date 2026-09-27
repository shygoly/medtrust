import {
  computeStepLeafHash,
  computeTraceMerkleRoot,
  generateTraceWitness,
  verifyTraceWitness,
  type ExecutionTraceStep,
} from "./execution-trace";
import { generateSm2KeyPair, publicKeyKid } from "../crypto/sm2";

describe("ExecutionTrace & Witness（执行轨迹与交付即验证）", () => {
  const steps: ExecutionTraceStep[] = [
    {
      step_index: 0,
      stage_id: "stage_filter",
      op: "filter.row_filter@1.0.0",
      op_digest: "a".repeat(64),
      input_digest: "1".repeat(64),
      output_digest: "2".repeat(64),
      params_digest: "3".repeat(64),
      label: "C0_internal",
    },
    {
      step_index: 1,
      stage_id: "stage_agg",
      op: "stat.aggregation@1.0.0",
      op_digest: "b".repeat(64),
      input_digest: "2".repeat(64),
      output_digest: "4".repeat(64),
      params_digest: "5".repeat(64),
      label: "C0_internal",
    },
    {
      step_index: 2,
      stage_id: "stage_declassify",
      op: "declassify.small_cell@1.0.0",
      op_digest: "c".repeat(64),
      input_digest: "4".repeat(64),
      output_digest: "6".repeat(64),
      params_digest: "7".repeat(64),
      label: "C3",
    },
  ];

  it("计算叶子哈希并生成确定性 Merkle 根", () => {
    const root1 = computeTraceMerkleRoot(steps);
    const root2 = computeTraceMerkleRoot(steps);
    expect(root1).toBe(root2);
    expect(root1.startsWith("sm3:")).toBe(true);
  });

  it("篡改任一步骤的算子或参数导致 Merkle 根发生变化", () => {
    const originalRoot = computeTraceMerkleRoot(steps);

    const tamperedSteps = [
      steps[0],
      {
        ...steps[1],
        op_digest: "f".repeat(64), // 篡改了中间算子的哈希
      },
      steps[2],
    ];

    const tamperedRoot = computeTraceMerkleRoot(tamperedSteps);
    expect(tamperedRoot).not.toBe(originalRoot);
  });

  it("生成执行轨迹见证凭单并成功验签", () => {
    const keyPair = generateSm2KeyPair();
    const kid = publicKeyKid(keyPair.publicKey);

    const witness = generateTraceWitness({
      jobId: "job_trace_1",
      contractId: "contract_trace_1",
      node: "urn:medtrust:node:tee-node-01",
      steps,
      resultDigest: "6".repeat(64),
      privateKey: keyPair.privateKey,
      publicKeyKid: kid,
    });

    expect(witness.version).toBe("medtrust.trace/1.0");
    expect(witness.step_count).toBe(3);
    expect(witness.sig.alg).toBe("SM2-SM3");

    const valid = verifyTraceWitness(witness, keyPair.publicKey);
    expect(valid).toBe(true);
  });

  it("篡改见证内容（如篡改 result_digest）后验签失败", () => {
    const keyPair = generateSm2KeyPair();
    const kid = publicKeyKid(keyPair.publicKey);

    const witness = generateTraceWitness({
      jobId: "job_trace_1",
      contractId: "contract_trace_1",
      node: "urn:medtrust:node:tee-node-01",
      steps,
      resultDigest: "6".repeat(64),
      privateKey: keyPair.privateKey,
      publicKeyKid: kid,
    });

    const tamperedWitness = {
      ...witness,
      result_digest: "0".repeat(64),
    };

    const valid = verifyTraceWitness(tamperedWitness, keyPair.publicKey);
    expect(valid).toBe(false);
  });
});
