/**
 * AMR Sentinel — 联邦 Q2（小细胞抑制反转）控制面 E2E.
 *
 * 模拟连接器侧已过 OutputGate 的聚合上报：示范甲 rare 已抑制，示范乙可发；
 * 控制面合并后罕见表型仍可发布。
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
const RARE_KEY = "rare_colistin_r_aba";
const MIN_CELL = 5;

function mockAmrContract(providerId: string, id: string) {
  return {
    id,
    dataProductId:
      providerId === "p-demohospa" ? "dp-amr-ast-demohospa" : "dp-amr-ast-demohospb",
    providerId,
    consumerId: "p-meddata",
    purpose: AMR_PURPOSE,
    retention: "阅后即焚",
    output: "仅聚合",
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    status: "active" as const,
    outputPolicy: {
      preset: "aggregate_only" as const,
      minCell: MIN_CELL,
      allowedArtifacts: ["condition_prevalence"],
    },
  };
}

type Agg = {
  analysisType: "condition-prevalence";
  cohortSize: number;
  buckets: Array<{
    key: string;
    count: number;
    rate: number;
    suppressed?: boolean;
  }>;
};

/** Simulate connector OutputGate on rare phenotype before control-plane upload. */
function gatedPrevalenceFromRecordsJson(
  hospitalKey: "demohospa" | "demohospb",
): Agg | null {
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
  const buckets = [...counts.entries()]
    .map(([key, count]) => {
      if (count > 0 && count < MIN_CELL) {
        return { key, count: 0, rate: 0, suppressed: true as const };
      }
      return { key, count, rate: +(count / n).toFixed(4) };
    })
    .sort((a, b) => b.count - a.count);
  return {
    analysisType: "condition-prevalence",
    cohortSize: rows.length,
    buckets,
  };
}

describe("AMR federated Q2 — control-plane small-cell narrative", () => {
  const contracts = {
    get: jest.fn(),
    effectiveStatus: jest.fn().mockReturnValue("active"),
  };
  const rwsAdmission = { admit: jest.fn() };
  const rwsTaskRepo = mockRepo<RwsTaskEntity>();
  const rwsAssignmentRepo = mockRepo<RwsAssignmentEntity>();
  let rwsOrchestrator: RwsOrchestratorService;

  const demohospaAgg = gatedPrevalenceFromRecordsJson("demohospa");
  const demohospbAgg = gatedPrevalenceFromRecordsJson("demohospb");
  const dataAvailable = Boolean(demohospaAgg && demohospbAgg);

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
      mockAmrContract("p-demohospa", "c-amr-h"),
      mockAmrContract("p-demohospb", "c-amr-r"),
    ]);
  });

  (dataAvailable ? it : it.skip)(
    "L1: 示范甲抑制 rare 后联邦合并仍可发",
    async () => {
      const hsRare = demohospaAgg!.buckets.find((b) => b.key === RARE_KEY);
      const rjRare = demohospbAgg!.buckets.find((b) => b.key === RARE_KEY);
      expect(hsRare?.count).toBe(0);
      expect(hsRare?.suppressed).toBe(true);
      expect(rjRare?.count ?? 0).toBeGreaterThanOrEqual(MIN_CELL);

      await rwsOrchestrator.submit({
        title: "AMR Q2 小细胞合并",
        purpose: AMR_PURPOSE,
        analysis: {
          type: "condition-prevalence",
          level: "L1",
          designType: "cross-sectional",
          rationale: "罕见黏菌素耐药鲍曼不动杆菌单院压制 / 联邦解锁",
        },
        contractIds: ["c-amr-h", "c-amr-r"],
        consumerId: "p-meddata",
      });

      const h = await rwsOrchestrator.pullPending("p-demohospa");
      await rwsOrchestrator.completeAssignment(h[0].assignmentId, "p-demohospa", {
        aggregate: demohospaAgg!,
      });

      const r = await rwsOrchestrator.pullPending("p-demohospb");
      const done = await rwsOrchestrator.completeAssignment(
        r[0].assignmentId,
        "p-demohospb",
        { aggregate: demohospbAgg! },
      );

      expect(done.status).toBe("completed");
      const mergedRare = done.merged?.buckets?.find((b) => b.key === RARE_KEY);
      expect(mergedRare?.count ?? 0).toBeGreaterThanOrEqual(MIN_CELL);
      expect(mergedRare?.count).toBe(rjRare!.count);
      expect(JSON.stringify(done.merged)).not.toContain("subjectKey");
    },
  );
});
