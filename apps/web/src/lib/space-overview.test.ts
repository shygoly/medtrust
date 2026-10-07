import test from "node:test";
import assert from "node:assert/strict";
import { buildSpaceOverview, type OverviewSources } from "./space-overview";

// 空间总览只显示真实接口返回的数据。回归：页面曾直接渲染前端夹具
// （参与方 5、「434k 行」、sf-3007 / rws-2990 / fl-3012 / rws-2999 等演示任务）。

const SOURCES: OverviewSources = {
  connectors: [
    {
      id: "reg-1",
      participantId: "p-huashan",
      healthStatus: "online",
      lastSeen: "2026-10-07T02:00:00.000Z",
      lastHeartbeat: { version: "1.4.2" },
    },
    {
      id: "reg-2",
      participantId: "p-ruijin",
      healthStatus: "offline",
      lastSeen: "2026-10-06T20:00:00.000Z",
      lastHeartbeat: null,
    },
  ],
  products: [{ id: "dp-1" }, { id: "dp-2" }, { id: "dp-3" }],
  contracts: [{ status: "active" }, { status: "active" }, { status: "revoked" }, { status: "draft" }],
  rws: [
    {
      taskId: "da75b890-2593-4c1a-851e-4358a0d56349",
      title: "药物警戒失衡信号·美罗培南",
      status: "completed",
      consumerId: "p-meddata",
      createdAt: "2026-10-07T09:48:54.000Z",
    },
    {
      taskId: "rws-running",
      title: "队列统计",
      status: "running",
      consumerId: "p-meddata",
      createdAt: "2026-10-05T00:00:00.000Z",
    },
  ],
  fl: [
    {
      taskId: "fl-1",
      title: "CKD 进展预测",
      status: "failed",
      consumerId: "p-meddata",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  secretflow: [{ taskId: "sf-1", state: "TRAINING", purpose: "LoRA 微调", createdAt: "2026-10-06T00:00:00.000Z" }],
  mdopJobs: [
    { id: "job-muxxx70z-e03b9dc1", purpose: "vaccine-safety", status: "PURGED", createdAt: "2026-10-07T01:00:00.000Z" },
    { id: "job-2", purpose: "pv", status: "RUNNING", createdAt: "2026-10-02T00:00:00.000Z" },
  ],
  attestations: [
    {
      id: "r1",
      kind: "receipt-chain",
      hash: "SM3:" + "6".repeat(64),
      txHash: "a".repeat(64),
      block: 998,
      anchoredAt: "2026-10-07T02:03:04.000Z",
      subjectType: "mdop-job",
      subjectId: "job-muxxx70z-e03b9dc1",
    },
    {
      id: "r2",
      kind: "output",
      hash: "SM3:" + "7".repeat(64),
      txHash: "b".repeat(64),
      block: 22,
      anchoredAt: "2026-09-20T05:40:00.000Z",
      subjectType: "rws-task",
      subjectId: "f7ea3eb9",
    },
  ],
};

test("stats are counted from the API payloads", () => {
  const o = buildSpaceOverview(SOURCES, "Asia/Shanghai");
  assert.deepEqual(o.stats, {
    connectors: 2,
    online: 1,
    products: 3,
    activeContracts: 2,
    activeTasks: 3, // rws-running + sf-1(TRAINING) + job-2(RUNNING)
    attestations: 2,
  });
  assert.deepEqual(o.unavailable, []);
});

test("connectors come from the registry heartbeat, named by participant", () => {
  const o = buildSpaceOverview(SOURCES, "Asia/Shanghai");
  assert.deepEqual(o.connectors, [
    {
      id: "reg-1",
      participantId: "p-huashan",
      name: "华山医院",
      state: "online",
      stateLabel: "在线",
      lastSeen: "2026-10-07 10:00",
      version: "1.4.2",
    },
    {
      id: "reg-2",
      participantId: "p-ruijin",
      name: "瑞金医院",
      state: "offline",
      stateLabel: "离线",
      lastSeen: "2026-10-07 04:00",
      version: "—",
    },
  ]);
});

test("latest tasks are the newest real tasks across RWS / FL / SecretFlow / MDOP", () => {
  const o = buildSpaceOverview(SOURCES, "Asia/Shanghai");
  assert.deepEqual(
    o.tasks.map((t) => [t.id, t.kindLabel, t.badge, t.href]),
    [
      [
        "da75b890-2593-4c1a-851e-4358a0d56349",
        "RWS",
        "completed",
        "/space/tasks/da75b890-2593-4c1a-851e-4358a0d56349?workload=rws",
      ],
      ["job-muxxx70z-e03b9dc1", "MDOP", null, "/space/mdop/jobs/job-muxxx70z-e03b9dc1"],
      ["sf-1", "SF", "running", "/space/federated/sf-1"],
      ["rws-running", "RWS", "running", "/space/tasks/rws-running?workload=rws"],
    ],
  );
  // PURGED 是「已销毁」终态，成功或失败都会走到——不硬套成「已完成」徽章，原样给状态文字
  assert.equal(o.tasks[1].statusText, "PURGED");
});

test("latest attestations are the newest ledger rows, formatted", () => {
  const o = buildSpaceOverview(SOURCES, "Asia/Shanghai");
  assert.deepEqual(
    o.attestations.map((a) => [a.kindLabel, a.txShort, a.block, a.time]),
    [
      ["审计回执链", "aaaaaa...aaaaaa", "Block #998", "2026-10-07 10:03"],
      ["计算结果", "bbbbbb...bbbbbb", "Block #22", "2026-09-20 13:40"],
    ],
  );
});

test("an empty space yields zeros and empty lists — never demo figures", () => {
  const o = buildSpaceOverview(
    {
      connectors: [],
      products: [],
      contracts: [],
      rws: [],
      fl: [],
      secretflow: [],
      mdopJobs: [],
      attestations: [],
    },
    "UTC",
  );
  assert.deepEqual(o.stats, {
    connectors: 0,
    online: 0,
    products: 0,
    activeContracts: 0,
    activeTasks: 0,
    attestations: 0,
  });
  assert.deepEqual(o.connectors, []);
  assert.deepEqual(o.tasks, []);
  assert.deepEqual(o.attestations, []);
});

test("a source that failed to load reads as unknown (null), not as zero", () => {
  const o = buildSpaceOverview({ ...SOURCES, connectors: undefined, attestations: undefined }, "UTC");
  assert.equal(o.stats.connectors, null);
  assert.equal(o.stats.online, null);
  assert.equal(o.stats.attestations, null);
  assert.equal(o.stats.products, 3);
  assert.deepEqual(o.unavailable, ["连接器状态", "存证账本"]);
});

test("active tasks is unknown when any task source failed (no silent undercount)", () => {
  const o = buildSpaceOverview({ ...SOURCES, mdopJobs: undefined }, "UTC");
  assert.equal(o.stats.activeTasks, null);
  assert.deepEqual(o.unavailable, ["MDOP 作业"]);
  // 已读到的任务照常列出
  assert.equal(o.tasks.length, 4);
});

test("no demo fixture leaks into the model", () => {
  const json = JSON.stringify(buildSpaceOverview(SOURCES, "UTC"));
  for (const fixture of ["434k", "sf-3007", "rws-2990", "fl-3012", "rws-2999"]) {
    assert.equal(json.includes(fixture), false, `demo fixture ${fixture} must not appear`);
  }
});
