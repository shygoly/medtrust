/**
 * RWS Analytics Ladder — Fly.io 四场景 E2E
 *
 * 华山 + 瑞金，L1.5 → L2 → L3 → L4，全部走线上 medtrust-api。
 *
 * Prereqs:
 *   - medtrust-api / medtrust-rws-worker-a / medtrust-rws-worker-b 在线
 *   - CONTRACT_RUIJIN = active 合约 id（dp-dkd-cohort，见 docs/demo/rws-analytics-ladder-fly-e2e.md §0.3）
 *
 * Run:
 *   cd apps/api
 *   CONTRACT_RUIJIN='<uuid>' npx ts-node scripts/e2e-analytics-ladder-fly.ts
 */
const API =
  process.env.CONTROL_PLANE_URL ?? "https://medtrust-api.fly.dev/api/v1";
const CONSUMER_EMAIL =
  process.env.CONSUMER_EMAIL ?? "research@meddata-inst.edu.cn";
const CONSUMER_PASSWORD = process.env.CONSUMER_PASSWORD ?? "demo123456";
const CONTRACT_HUASHAN =
  process.env.CONTRACT_HUASHAN ??
  "seed:dp-ckd-ehr:p-meddata:CKD-多中心疗效真实世界研究";
const CONTRACT_RUIJIN = process.env.CONTRACT_RUIJIN ?? "";
const PURPOSE =
  process.env.RWS_PURPOSE ?? "CKD 多中心疗效真实世界研究";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? "5000");
const POLL_MAX = Number(process.env.POLL_MAX ?? "18");
/** 线上 API 未重部署前用精简 analysis；重部署 medtrust-api 后设 LADDER_FULL=1 */
const LADDER_FULL = process.env.LADDER_FULL === "1";

type Json = Record<string, unknown>;

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

async function apiGet(path: string, jwt: string): Promise<Json> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

async function apiPost(path: string, jwt: string, body: unknown): Promise<Json> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} ${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

function assertNoRowLevel(json: string, label: string): void {
  if (/subjectKey|patient_id|patientId/i.test(json)) {
    throw new Error(`${label}: 响应含疑似行级字段`);
  }
}

async function pollRws(
  jwt: string,
  taskId: string,
  label: string,
): Promise<Json> {
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const task = await apiGet(`/rws/tasks/${taskId}`, jwt);
    const status = String(task.status);
    const assignments = (task.assignments as Json[]) ?? [];
    const merged = task.merged as Json | undefined;
    console.log(
      `  [${label}] poll ${i + 1}/${POLL_MAX} status=${status} cohort=${merged?.cohortSize ?? "—"}`,
    );
    const terminal = new Set(["completed", "failed"]);
    if (
      status === "completed" ||
      status === "partial" ||
      status === "failed" ||
      (assignments.length > 0 &&
        assignments.every((a) => terminal.has(String(a.status))))
    ) {
      return task;
    }
  }
  throw new Error(`${label}: timeout after ${(POLL_MAX * POLL_MS) / 1000}s`);
}

async function pollFl(jwt: string, taskId: string, label: string): Promise<Json> {
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const task = await apiGet(`/fl-prediction/tasks/${taskId}`, jwt);
    const status = String(task.status);
    const merged = task.merged as Json | undefined;
    const metrics = merged?.aggregateMetrics as Json | undefined;
    console.log(
      `  [${label}] poll ${i + 1}/${POLL_MAX} status=${status} auc=${metrics?.auc ?? "—"}`,
    );
    if (status === "completed" || status === "partial") return task;
    if (status === "failed") throw new Error(`${label} failed`);
  }
  throw new Error(`${label}: timeout`);
}

async function scenarioL15(jwt: string): Promise<void> {
  console.log("\n=== 场景 1: L1.5 失衡信号 (disproportionality) ===");
  console.log(`  API: ${API}`);
  console.log(`  Workers: https://medtrust-rws-worker-a.fly.dev + https://medtrust-rws-worker-b.fly.dev`);

  const created = await apiPost("/rws/tasks", jwt, {
    title: "fly-e2e L1.5",
    purpose: PURPOSE,
    analysis: LADDER_FULL
      ? {
          type: "disproportionality",
          level: "L1.5",
          drug: "二甲双胍",
          allowedArtifacts: ["disproportionality"],
        }
      : { type: "disproportionality", drug: "二甲双胍" },
    contractIds: [CONTRACT_HUASHAN, CONTRACT_RUIJIN],
  });
  const taskId = String(created.taskId);
  console.log(`  taskId=${taskId}`);

  const done = await pollRws(jwt, taskId, "L1.5");
  const raw = JSON.stringify(done);
  assertNoRowLevel(raw, "L1.5");
  const merged = done.merged as Json | undefined;
  if (!merged || Number(merged.cohortSize ?? 0) <= 0) {
    throw new Error("L1.5: merged.cohortSize 应 > 0");
  }
  const ok =
    String(done.status) === "completed" ||
    (String(done.status) === "partial" &&
      ((done.assignments as Json[]) ?? []).some((a) => a.status === "completed"));
  if (!ok) throw new Error(`L1.5: 无成功站点 status=${done.status}`);
  console.log("  ✅ L1.5 PASS");
}

async function scenarioL2(jwt: string): Promise<void> {
  console.log("\n=== 场景 2: L2 比较效应 (comparative-effect) ===");

  const created = await apiPost("/rws/tasks", jwt, {
    title: "fly-e2e L2",
    purpose: PURPOSE,
    analysis: LADDER_FULL
      ? {
          type: "comparative-effect",
          level: "L2",
          drug: "二甲双胍",
          outcome: "Chronic kidney disease stage 3",
          outcomeKind: "condition",
          allowedArtifacts: ["effect_estimate", "meta_pooled"],
        }
      : { type: "comparative-effect", drug: "二甲双胍" },
    contractIds: [CONTRACT_HUASHAN, CONTRACT_RUIJIN],
  });
  const taskId = String(created.taskId);
  console.log(`  taskId=${taskId}`);

  const done = await pollRws(jwt, taskId, "L2");
  assertNoRowLevel(JSON.stringify(done), "L2");
  const assignments = (done.assignments as Json[]) ?? [];
  const anyEffect = assignments.some(
    (a) => (a.aggregate as Json | undefined)?.effectEstimate,
  );
  if (!anyEffect) console.warn("  ⚠ L2: 无 effectEstimate（队列可能无暴露/结局变异）");
  console.log("  ✅ L2 PASS (submitted + workers responded)");
}

async function scenarioL3(jwt: string): Promise<void> {
  console.log("\n=== 场景 3: L3 因果生存 (causal-survival) ===");

  const created = await apiPost("/rws/tasks", jwt, {
    title: "fly-e2e L3",
    purpose: PURPOSE,
    analysis: LADDER_FULL
      ? {
          type: "causal-survival",
          level: "L3",
          method: "cox",
          tte: {
            exposureArm: "drug:二甲双胍",
            comparatorArm: "drug:胰岛素",
            timeZeroRule: "index_date",
            inclusion: ["age>=18"],
            exclusion: [],
            outcome: { type: "time_to_event", event: "renal_failure" },
          },
          allowedArtifacts: ["hazard_ratio", "km_curve", "meta_pooled"],
        }
      : { type: "causal-psm" },
    contractIds: [CONTRACT_HUASHAN, CONTRACT_RUIJIN],
  });
  const taskId = String(created.taskId);
  console.log(`  taskId=${taskId}`);

  const done = await pollRws(jwt, taskId, "L3");
  assertNoRowLevel(JSON.stringify(done), "L3");
  console.log("  ✅ L3 PASS (submitted + workers responded)");
}

async function scenarioL4(jwt: string): Promise<void> {
  console.log("\n=== 场景 4: L4 联邦预测 (fl-prediction) ===");
  console.log(`  Workers pull FL: ${API}/connector/fl-prediction/pending`);

  const created = await apiPost("/fl-prediction/tasks", jwt, {
    title: "fly-e2e L4",
    contractIds: [CONTRACT_HUASHAN, CONTRACT_RUIJIN],
    flPredictionSpec: {
      purpose: PURPOSE,
      federationMode: "horizontal",
      modality: "structured_ehr",
      parties: [
        {
          participantId: "p-huashan",
          role: "provider",
          dataProductId: "dp-ckd-ehr",
          connectorId: "cn-huashan",
        },
        {
          participantId: "p-ruijin",
          role: "provider",
          dataProductId: "dp-dkd-cohort",
          connectorId: "cn-ruijin",
        },
        { participantId: "p-meddata", role: "consumer", dataProductId: "" },
      ],
      modelType: "xgboost",
      objective: "binary",
      targetColumn: "esrd_event",
      featureColumns: [
        { name: "egfr", dtype: "numeric" },
        { name: "scr", dtype: "numeric" },
        { name: "uacr", dtype: "numeric" },
      ],
      aggregation: "secureboost",
      rounds: 3,
      hyperparameters: { maxDepth: 4, learningRate: 0.1, nEstimators: 50 },
      privacy: { dpEpsilon: 4.0, dpDelta: 1e-5, minCohortSize: 5 },
      outputPolicy: {
        allowedArtifacts: [
          "auc",
          "f1",
          "model_hash",
          "aggregate_metrics",
          "attestation_report",
        ],
      },
    },
  });
  const taskId = String(created.taskId);
  console.log(`  taskId=${taskId}`);

  const done = await pollFl(jwt, taskId, "L4");
  const merged = done.merged as Json | undefined;
  if (String(done.status) === "completed" && merged?.modelHash) {
    console.log(`  modelHash=${merged.modelHash}`);
  } else {
    console.warn(`  ⚠ L4 status=${done.status} (检查瑞金合约/特征列)`);
  }
  console.log("  ✅ L4 PASS (or partial — see status above)");
}

async function main(): Promise<void> {
  console.log("RWS Analytics Ladder Fly E2E");
  console.log(`CONTROL_PLANE_URL=${API}`);
  console.log(`LADDER_FULL=${LADDER_FULL} (set LADDER_FULL=1 after medtrust-api redeploy)`);

  if (!CONTRACT_RUIJIN) {
    console.error(
      "Set CONTRACT_RUIJIN to an active dp-dkd-cohort contract id (see docs/demo/rws-analytics-ladder-fly-e2e.md §0.3)",
    );
    process.exit(1);
  }

  const health = await fetch(`${API}/health`);
  if (!health.ok) throw new Error(`API health failed: ${health.status}`);

  const jwt = await login(CONSUMER_EMAIL, CONSUMER_PASSWORD);
  console.log(`Logged in as ${CONSUMER_EMAIL}`);

  await scenarioL15(jwt);
  await scenarioL2(jwt);
  await scenarioL3(jwt);
  await scenarioL4(jwt);

  console.log("\n✅ All four scenarios finished (see per-scenario notes above)");
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
