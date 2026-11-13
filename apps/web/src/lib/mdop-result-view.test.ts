import test from "node:test";
import assert from "node:assert/strict";
import {
  analysisTypeLabel,
  mdopResultEmptyHint,
  mdopResultView,
  nodeParticipantId,
} from "./mdop-result-view";
import { scriRelativeIncidence } from "./scri-relative-incidence";

const SAMPLE_C3 = {
  analysisType: "disproportionality",
  cohortSize: 5000,
  buckets: [
    {
      key: "acute pancreatitis",
      count: 298,
      rate: 0.0596,
      b: 2560,
      c: 93,
      d: 2049,
      prr: 2.401544,
      prrCi95: [1.9158259311801134, 3.010405979070312],
      ror: 2.564693,
      rorCi95: [2.01757556605587, 3.260174209605859],
      chiSqYates: 62.052594,
      ic: 0.414261,
      signal: true,
    },
  ],
};

test("disproportionality：可读名 + 展开 PRR/ROR/CI/signal", () => {
  const v = mdopResultView(SAMPLE_C3);
  assert.equal(v.kind, "disproportionality");
  assert.equal(v.analysisLabel, "失衡信号（L1.5）");
  assert.match(v.summaryLine, /分析队列共 5000 人/);
  assert.match(v.summaryLine, /至少一项达到安全信号阈值/);
  assert.equal(v.hasSignal, true);
  assert.equal(v.rows.length, 1);
  assert.equal(v.rows[0]!.key, "acute pancreatitis");
  assert.equal(v.rows[0]!.outcomeLabel, "急性胰腺炎");
  assert.equal(v.rows[0]!.count, "298");
  assert.equal(v.rows[0]!.prr, "2.402");
  assert.equal(v.rows[0]!.ror, "2.565");
  assert.match(v.rows[0]!.prrCi, /^\[1\.916/);
  assert.equal(v.rows[0]!.signalLabel, "检出");
  assert.match(v.summaryLine, /至少一项达到安全信号阈值/);
});

test("缺字段时列回退 —，不丢已有 count", () => {
  const v = mdopResultView({
    analysisType: "disproportionality",
    cohortSize: 10,
    buckets: [{ key: "x", count: 3 }],
  });
  assert.equal(v.rows[0]!.count, "3");
  assert.equal(v.rows[0]!.prr, "—");
  assert.equal(v.rows[0]!.ror, "—");
  assert.equal(v.rows[0]!.prrCi, "—");
  assert.equal(v.rows[0]!.signalLabel, "—");
  assert.equal(v.hasSignal, false);
});

test("分析类型可读名；未知回退原文", () => {
  assert.equal(analysisTypeLabel("disproportionality"), "失衡信号（L1.5）");
  assert.equal(analysisTypeLabel("custom-op"), "custom-op");
});

test("节点 id 解析", () => {
  assert.equal(
    nodeParticipantId("urn:tds:sh-med:participant:p-demohospa"),
    "p-demohospa",
  );
  assert.equal(nodeParticipantId("p-demohospa"), "p-demohospa");
  assert.equal(nodeParticipantId("urn:tds:sh-med:participant:platform"), "platform");
});

test("无结果空态文案按作业状态区分", () => {
  assert.match(mdopResultEmptyHint("RUNNING"), /尚未就绪/);
  assert.match(mdopResultEmptyHint("PURGED"), /未保留可读的 C3/);
  assert.match(mdopResultEmptyHint("FAILED"), /未返回可展示/);
});

test("null 结果为空 kind", () => {
  assert.equal(mdopResultView(null).kind, "empty");
});

test("paired-cohort：四计数展开 + 粗率方向", () => {
  const v = mdopResultView({
    analysisType: "paired-cohort",
    cohortSize: 1000,
    exposed: 400,
    outcome: 120,
    exposedWithOutcome: 80,
  });
  assert.equal(v.kind, "paired-cohort");
  assert.match(v.summaryLine, /分析队列共 1000 人/);
  assert.match(v.summaryLine, /高于未暴露者/);
  assert.equal(v.kvRows.length, 4);
  assert.equal(v.kvRows[0]!.value, "1000");
  assert.equal(v.kvRows[3]!.value, "80");
  assert.doesNotMatch(v.summaryLine, /队列 n=/);
});

test("paired-cohort：缺字段不填 0", () => {
  const v = mdopResultView({
    analysisType: "paired-cohort",
    cohortSize: 100,
  });
  assert.equal(v.kvRows[0]!.value, "100");
  assert.equal(v.kvRows[1]!.value, "—");
  assert.match(v.summaryLine, /计数不完整/);
});

test("fl-prediction：摘要含轮次与 AUC，指标中文", () => {
  const v = mdopResultView({
    analysisType: "fl-prediction",
    modelType: "xgboost",
    modelHash: "abc123",
    roundsCompleted: 3,
    totalRounds: 5,
    aggregateMetrics: { auc: 0.812, f1: 0.7, precision: 0.65, recall: 0.76, accuracy: 0.8 },
  });
  assert.equal(v.kind, "fl-prediction");
  assert.match(v.summaryLine, /训练轮次 3\/5/);
  assert.match(v.summaryLine, /合并 AUC 0\.812/);
  assert.ok(v.flMetrics.some((m) => m.label.includes("区分度")));
  assert.equal(v.modelHash, "abc123");
});

test("scriRelativeIncidence 对齐 API 参考样本", () => {
  const ri = scriRelativeIncidence({
    riskEvents: 43,
    controlEvents: 29,
    riskDays: 7,
    controlDays: 21,
  })!;
  assert.ok(Math.abs(ri.ri - 4.448) < 0.01);
  assert.ok(ri.lower > 2.6 && ri.lower < 2.8);
  assert.ok(ri.upper > 7.2 && ri.upper < 7.6);
  assert.equal(
    scriRelativeIncidence({
      riskEvents: 3,
      controlEvents: 0,
      riskDays: 7,
      controlDays: 21,
    }),
    null,
  );
});

test("vaccine-scri：摘要含窗口 + RI / 不可估计", () => {
  const v = mdopResultView({
    analysisType: "vaccine-scri",
    windows: { risk: [1, 7], control: [8, 28] },
    strata: [
      {
        key: "<40|M",
        doses: 1000,
        riskEvents: 43,
        controlEvents: 29,
      },
      {
        key: "40+|F",
        doses: 10,
        riskEvents: 1,
        controlEvents: 0,
        suppressed: false,
      },
      {
        key: "40+|M",
        doses: 2,
        riskEvents: 1,
        controlEvents: 1,
        suppressed: true,
      },
    ],
  });
  assert.equal(v.kind, "vaccine-scri");
  assert.match(v.summaryLine, /风险期/);
  assert.match(v.summaryLine, /对照期/);
  assert.match(v.summaryLine, /3 个分层/);
  assert.doesNotMatch(v.summaryLine, /^3 个分层$/);
  assert.equal(v.scriStrata[0]!.keyLabel, "40 岁以下男性");
  assert.match(v.scriStrata[0]!.ri, /^4\.44/);
  assert.equal(v.scriStrata[1]!.ri, "不可估计");
  assert.equal(v.scriStrata[2]!.suppressed, true);
});
