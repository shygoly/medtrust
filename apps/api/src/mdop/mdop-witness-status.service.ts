import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MdopAttestationEntity, MdopReceiptEntity } from "@medtrust/database";

/**
 * 「会话证明 + 持有方核验结论」的**作业视图**（任务 7.4）。
 *
 * 把三样东西对起来：
 *  - `cp_mdop_attestation`：节点上报的**会话见证本体**（证明报告 + KMS 释放凭据）；
 *  - `cp_mdop_receipt(kind=audit)`：持有方核验后写的 `WITNESS_VERIFIED` / `WITNESS_REJECTED` 回执
 *    （由**持有方自己的连接器**签名上报，平台不知道它的本地日志）；
 *  - 该作业的**参与节点**：用来指出「哪些节点连见证都还没上报」。
 *
 * 三态必须分开（与发布审查清单同一套诚实原则）：
 *  `verified` / `rejected`（附原因）/ **`unverified`**（本院还没核验，或节点还没上报见证）——
 *  **「没核验」绝不能被显示成「核验通过」**。
 */

export interface WitnessVerificationView {
  node: string;
  kind: string;
  measurement: string;
  tcb: string | null;
  quoteDigest: string;
  keyId: string | null;
  expiresAt: string;
  verifiedBy: string;
  warrantDigest: string | null;
  /** 持有方核验结论（按凭据摘要与 quote 摘要对齐）。 */
  holderVerification: {
    status: "verified" | "rejected";
    /** 核验方（持有方 URN）。 */
    verifier: string;
    at: string;
    reason: string | null;
  } | null;
}

export interface JobWitnessStatus {
  witnesses: WitnessVerificationView[];
  /** 至今**没有**任何见证上报的参与节点（不得显示成「核验通过」）。 */
  nodesWithoutWitness: string[];
  /** 有见证但**没有任何持有方核验回执**的节点。 */
  nodesWithoutVerification: string[];
}

@Injectable()
export class MdopWitnessStatusService {
  constructor(
    @InjectRepository(MdopAttestationEntity, "controlplane")
    private readonly attestations: Repository<MdopAttestationEntity>,
    @InjectRepository(MdopReceiptEntity, "controlplane")
    private readonly receipts: Repository<MdopReceiptEntity>,
  ) {}

  async forJob(
    jobId: string,
    expectedNodes: readonly string[],
  ): Promise<JobWitnessStatus> {
    const rows = await this.attestations.find({
      where: { jobId },
      order: { verifiedAt: "ASC" },
    });
    const audit = await this.receipts.find({ where: { jobId, kind: "audit" } });

    // 核验回执按「凭据摘要」对齐（`output_digest` = warrant digest）；
    // 没有凭据摘要的旧回执按 quote 摘要（`input_digests[0]`）兜底对齐。
    const byWarrant = new Map<string, (typeof audit)[number]>();
    const byQuote = new Map<string, (typeof audit)[number]>();
    for (const row of audit) {
      const payload = row.payload as {
        event?: string;
        output_digest?: string | null;
        input_digests?: string[];
        signer?: string;
        at?: string;
        detail?: { reason?: string };
      };
      if (
        payload.event !== "WITNESS_VERIFIED" &&
        payload.event !== "WITNESS_REJECTED"
      )
        continue;
      if (payload.output_digest) byWarrant.set(payload.output_digest, row);
      if (payload.input_digests?.[0])
        byQuote.set(payload.input_digests[0], row);
    }

    const witnesses: WitnessVerificationView[] = rows.map((row) => {
      const matched =
        (row.warrantDigest ? byWarrant.get(row.warrantDigest) : undefined) ??
        byQuote.get(row.quoteDigest);
      const payload = matched?.payload as
        | {
            event?: string;
            signer?: string;
            at?: string;
            detail?: { reason?: string };
          }
        | undefined;
      return {
        node: row.node,
        kind: row.kind,
        measurement: row.measurement,
        tcb: row.tcb ?? null,
        quoteDigest: row.quoteDigest,
        keyId: row.keyId ?? null,
        expiresAt: row.expiresAt,
        verifiedBy: row.verifiedBy,
        warrantDigest: row.warrantDigest ?? null,
        holderVerification:
          payload?.event === "WITNESS_VERIFIED" ||
          payload?.event === "WITNESS_REJECTED"
            ? {
                status:
                  payload.event === "WITNESS_VERIFIED"
                    ? "verified"
                    : "rejected",
                verifier: payload.signer ?? "",
                at: payload.at ?? "",
                reason: payload.detail?.reason ?? null,
              }
            : null,
      };
    });

    const withWitness = new Set(witnesses.map((w) => w.node));
    const withVerification = new Set(
      witnesses.filter((w) => w.holderVerification !== null).map((w) => w.node),
    );
    return {
      witnesses,
      nodesWithoutWitness: expectedNodes.filter((n) => !withWitness.has(n)),
      nodesWithoutVerification: expectedNodes.filter(
        (n) => withWitness.has(n) && !withVerification.has(n),
      ),
    };
  }
}
