/**
 * AMR Sentinel — 联邦 Q1（condition-prevalence）控制面 E2E.
 *
 * 双院 admission → submit → pull/complete with real aggregates derived from
 * synthetic AMR records.json (when present). Verifies merge + no row egress.
 */
import * as fs from "fs";
import * as path from "path";
import { AttestationService } from "../digital-contract/attestation.service";
import { ContractService } from "../digital-contract/contract.service";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { mockRepo } from "../test-utils/mock-repo";
import { RwsAssignmentEntity, RwsTaskEntity } from "@medtrust/database";
import { L0ValidationMergeService } from "../rws-orchestrator/l0-validation-merge";
import { MetaAnalysisService } from "../rws-orchestrator/meta-analysis.service";
import { RwsAdmissionService } from "../rws-orchestrator/rws-admission.service";
import { RwsOrchestratorService } from "../rws-orchestrator/rws-orchestrator.service";
import { autoFillAggregateHash } from "../rws-orchestrator/test-utils/auto-fill-aggregate-hash";

const AMR_PURPOSE = "抗菌药物耐药监测真实世界研究";

function mockAmrContract(providerId: string, id: string) {
  return {
    id,
    dataProductId:
      providerId === "p-huashan" ? "dp-amr-ast-huashan" : "dp-amr-ast-ruijin",
    providerId,
    consumerId: "p-meddata",
    purpose: AMR_PURPOSE,
    retention: "阅后即焚",
    output: "仅聚合",
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    status: "active" as const,
  };
}

/** Build condition-prevalence aggregate from connector records.json (no Nest boot). */
function prevalenceFromRecordsJson(hospitalKey: "huashan" | "ruijin"): {
  analysisType: "condition-prevalence";
  cohortSize: number;
  buckets: Array<{ key: string; count: number; rate: number }>;
} | null {
  const file = path.resolve(
    __dirname,
    "../../../../../data/synthetic/amr/connectors",
    hospitalKey,
    "records.json",
  );
  if (!fs.existsSync(file)) return null;
  const rows = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<{
    conditions: string[];
  }>;
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const c of r.conditions ?? []) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  const n = rows.length || 1;
  return {
    analysisType: "condition-prevalence",
    cohortSize: rows.length,
    buckets: [...counts.entries()]
      .map(([key, count]) => ({ key, count, rate: +(count / n).toFixed(4) }))
      .sort((a, b) => b.count - a.count),
  };
}

describe("AMR federated Q1 — control-plane orchestration", () => {
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue("active"),
  };
  const rwsAdmission = { admit: jest.fn() };
  const rwsTaskRepo = mockRepo<RwsTaskEntity>();
  const rwsAssignmentRepo = mockRepo<RwsAssignmentEntity>();
  let rwsOrchestrator: RwsOrchestratorService;

  const huashanAgg = prevalenceFromRecordsJson("huashan");
  const ruijinAgg = prevalenceFromRecordsJson("ruijin");
  const dataAvailable = Boolean(huashanAgg && ruijinAgg);

  beforeEach(() => {
    jest.clearAllMocks();
    autoFillAggregateHash();
    rwsOrchestrator = new RwsOrchestratorService(
      rwsAdmission as unknown as RwsAdmissionService,
      contracts as unknown as ContractService,
      new MetaAnalysisService(
        new GMCryptoService(),
        new AttestationService(new GMCryptoService()),
      ),
      new L0ValidationMergeService(
        new GMCryptoService(),
        new AttestationService(new GMCryptoService()),
      ),
      rwsTaskRepo,
      rwsAssignmentRepo,
    );
    rwsAdmission.admit.mockResolvedValue([
      mockAmrContract("p-huashan", "c-amr-h"),
      mockAmrContract("p-ruijin", "c-amr-r"),
    ]);
  });

  (dataAvailable ? it : it.skip)(
    "L1 condition-prevalence: dual-site merge without subjectKey",
    async () => {
      const record = await rwsOrchestrator.submit({
        title: "AMR Q1 耐药率",
        purpose: AMR_PURPOSE,
        analysis: {
          type: "condition-prevalence",
          level: "L1",
          designType: "cross-sectional",
          rationale:
            "主要致病菌对关键抗生素耐药率与标本分层描述（CHINET 对齐）",
        },
        contractIds: ["c-amr-h", "c-amr-r"],
        consumerId: "p-meddata",
      });

      const h = await rwsOrchestrator.pullPending("p-huashan");
      expect(h).toHaveLength(1);
      await rwsOrchestrator.completeAssignment(h[0].assignmentId, "p-huashan", {
        aggregate: huashanAgg!,
      });

      const r = await rwsOrchestrator.pullPending("p-ruijin");
      expect(r).toHaveLength(1);
      const done = await rwsOrchestrator.completeAssignment(
        r[0].assignmentId,
        "p-ruijin",
        { aggregate: ruijinAgg! },
      );

      expect(done.status).toBe("completed");
      expect(done.merged?.cohortSize).toBe(
        huashanAgg!.cohortSize + ruijinAgg!.cohortSize,
      );
      expect(JSON.stringify(done.merged)).not.toContain("subjectKey");
      expect(JSON.stringify(done.merged)).not.toContain("patient_hash");

      const nKpn =
        done.merged?.buckets?.find((b) => b.key === "organism:kpn")?.count ?? 0;
      const nMemR =
        done.merged?.buckets?.find((b) => b.key === "resist:kpn:MEM:R")
          ?.count ?? 0;
      expect(nKpn).toBeGreaterThan(100);
      const rate = nMemR / nKpn;
      expect(rate).toBeGreaterThan(0.1);
      expect(rate).toBeLessThan(0.4);
      expect(record.taskId).toBeDefined();
    },
  );
});
