import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopWitnessStatusService } from "./mdop-witness-status.service";

/**
 * 会话见证 + 持有方核验结论的作业视图（任务 7.4）。
 *
 * 三态必须分开：verified / rejected（附原因）/ **未核验**（`holderVerification=null`）——
 * 「没核验」绝不能被显示成「核验通过」。
 */

const JOB = "job-witness";
const TEE = "urn:tds:sh-med:participant:tee-1";
const HOSP = "urn:tds:sh-med:participant:p-huashan";
const PLATFORM = "urn:tds:sh-med:participant:platform";
const WARRANT = `sm3:${"a".repeat(64)}`;
const QUOTE = `sm3:${"b".repeat(64)}`;
const AT = "2026-09-25T10:00:00.000Z";

function witnessRow(over: Record<string, unknown> = {}) {
  return {
    id: `${TEE}#${WARRANT}`,
    node: TEE,
    jobId: JOB,
    credentialId: "tkt-1",
    contractId: "ctr-1",
    keyId: "k-1",
    kind: "tdx",
    measurement: `sm3:${"c".repeat(64)}`,
    tcb: "3.1.2",
    quoteDigest: QUOTE,
    verifiedAt: AT,
    expiresAt: "2026-09-25T10:10:00.000Z",
    verifiedBy: "kms://hospital",
    warrantDigest: WARRANT,
    chainTx: null,
    chainBlock: null,
    ...over,
  };
}

function verificationReceipt(over: Record<string, unknown> = {}) {
  return {
    id: `r-${Math.random()}`,
    jobId: JOB,
    node: HOSP,
    kind: "audit",
    prevHash: null,
    payload: {
      receipt_id: "r-1",
      job_id: JOB,
      stage: "__witness__",
      event: "WITNESS_VERIFIED",
      input_digests: [QUOTE],
      op_digest: "kms:kms://hospital",
      output_digest: WARRANT,
      label: null,
      prev_receipt_hash: null,
      signer: HOSP,
      at: AT,
      sig: { alg: "SM2-SM3", kid: "d".repeat(64), value: "00" },
      ...over,
    },
  };
}

function service(attestationRows: unknown[], receiptRows: unknown[]) {
  const attRepo = mockRepo();
  const receiptRepo = mockRepo();
  for (const r of attestationRows) void attRepo.save(attRepo.create(r));
  for (const r of receiptRows) void receiptRepo.save(receiptRepo.create(r));
  return new MdopWitnessStatusService(attRepo as never, receiptRepo as never);
}

describe("会话见证与持有方核验结论（任务 7.4）", () => {
  it("见证 + 本院核验回执 → verified（按凭据摘要对齐）", async () => {
    const svc = service([witnessRow()], [verificationReceipt()]);
    // 调用方（控制器）负责把平台自身从「应有见证的节点」里排除
    const out = await svc.forJob(JOB, [TEE]);
    expect(out.witnesses).toHaveLength(1);
    expect(out.witnesses[0]).toMatchObject({
      node: TEE,
      keyId: "k-1",
      holderVerification: {
        status: "verified",
        verifier: HOSP,
        at: AT,
        reason: null,
      },
    });
    expect(out.nodesWithoutVerification).toEqual([]);
    expect(out.nodesWithoutWitness).toEqual([]);
  });

  it("拒绝回执带原因 → rejected（如实显示原因，不吞掉）", async () => {
    const svc = service(
      [witnessRow()],
      [
        verificationReceipt({
          event: "WITNESS_REJECTED",
          detail: { reason: "E_MEASUREMENT_NOT_ALLOWED: 换了代码" },
        }),
      ],
    );
    const out = await svc.forJob(JOB, [TEE]);
    expect(out.witnesses[0].holderVerification).toMatchObject({
      status: "rejected",
      reason: expect.stringContaining("E_MEASUREMENT_NOT_ALLOWED"),
    });
  });

  it("有见证但没人核验 → holderVerification 为 null，并列入 nodesWithoutVerification（**不显示成通过**）", async () => {
    const svc = service([witnessRow()], []);
    const out = await svc.forJob(JOB, [TEE]);
    expect(out.witnesses[0].holderVerification).toBeNull();
    expect(out.nodesWithoutVerification).toEqual([TEE]);
  });

  it("参与节点连见证都没上报 → nodesWithoutWitness（与「未核验」分开）", async () => {
    const svc = service([], []);
    const out = await svc.forJob(JOB, [TEE, PLATFORM]);
    expect(out.witnesses).toHaveLength(0);
    expect(out.nodesWithoutWitness).toEqual([TEE, PLATFORM]);
  });

  it("旧回执没有凭据摘要时按 quote 摘要兜底对齐", async () => {
    const svc = service(
      [witnessRow()],
      [verificationReceipt({ output_digest: null })],
    );
    const out = await svc.forJob(JOB, [TEE]);
    expect(out.witnesses[0].holderVerification?.status).toBe("verified");
  });
});
