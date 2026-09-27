# L3 因果推断 (组 5) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在模式 A 下交付 L3 目标试验仿真(TTE)因果分析——连接器 TEE 内调用本地 Python agent 完成站内 PSM/IPTW 或 Cox,仅出站点级 ATE/HR+SE 与分箱 KM;中心经既有 `MetaAnalysisService` 做随机效应 meta;输出闸门保护 KM 尾部。

**Architecture:** 契约先行(5.6 TTE 字段) → 连接器 in-TEE gRPC 调 co-located agent(5.1,复用 `secretflow.proto` 侧车模式但**新增** `rws_causal.proto`,数据不出 TEE) → agent 数值核 PSM/Cox(5.2/5.3) → 连接器 output-gate KM 规则(5.5) → API `rws-orchestrator` 拉取合并(5.4,镜像 L2 `comparative-effect-merge`)。**不算子在 API 侧 dispatch**(与 SecretFlow FL 不同,遵守 design D3)。

**Tech Stack:** TypeScript(NestJS connector/api,Jest), Python agent(`grpcio`, `lifelines`, `scikit-learn`, `numpy`), protobuf(`packages/proto`), 既有 `MetaAnalysisService`(支持 `log_hr`/`ate`)。

**Spec 锚点:** `openspec/changes/rws-analytics-ladder/tasks.md` 组5; `specs/rws-compute/spec.md` L3/KM scenarios; `design.md` D1/D3/D5。

**执行须知:** 计划中的 `git commit` **仅在用户授权时执行**;每步先红后绿。纪律:@superpowers:test-driven-development、@superpowers:executing-plans。

**当前缺口(2026-07):** 连接器无 gRPC; agent 仅 FL; `InternalRecord` 无生存字段; `RwsAnalysis.type` 无 causal; output-gate 无 KM; orchestrator 仅 L2 meta 接线。

---

## 推荐切片顺序

```text
5.6 TTE 契约 ──► 5.1 gRPC 通路 ──┬──► 5.2 PSM/IPTW (agent)
                                 └──► 5.3 Cox/KM (agent)
                                           │
                                           ▼
                                    5.5 KM 输出闸门
                                           │
                                           ▼
                                    5.4 中心 meta 合并
```

5.2 与 5.3 可在 5.1 绿后并行;5.4/5.5 依赖 agent 产物形状稳定。

---

## File Structure

| 路径 | 职责 |
|------|------|
| **契约 (5.6)** | |
| `apps/api/src/compute-task/dto/rws-analysis-spec.ts` | `TteSpec`、`CausalMethod`、校验 |
| `apps/api/src/compute-task/dto/rws-analysis-spec.spec.ts` | TTE 校验黄金用例 |
| `apps/connector/src/domain/types.ts` | 同步 TTE + `causal-psm`/`causal-survival` + `HazardRatioPayload`/`KmCurvePayload` |
| `apps/api/src/runtime/rws-orchestrator/types.ts` | 同步 analysis/aggregate 类型 |
| **Proto + 通路 (5.1)** | |
| `packages/proto/rws_causal.proto` | `RwsCausalAgent.RunLocalCausal` RPC |
| `apps/connector/src/domain/causal/causal-agent-client.ts` | gRPC client → `AGENT_GRPC_URL`(默认 `127.0.0.1:5024`) |
| `apps/connector/src/domain/causal/causal-agent-client.spec.ts` | mock server / 契约测试 |
| `apps/connector/src/domain/causal/causal-materializer.ts` | `InternalRecord` → agent JSON(无标识符) |
| `apps/connector/src/domain/causal/causal-executor.ts` | TEE 内 seal → materialize → gRPC → 解析安全结果 |
| `apps/connector/src/domain/rws-executor.ts` | 路由 `causal-psm` / `causal-survival` |
| `apps/connector/src/domain/connector-task-runner.ts` | 允许 `level === 'L3'` |
| `apps/agent/src/medtrust_agent/rws_causal_servicer.py` | gRPC handler 入口 |
| `apps/agent/src/medtrust_agent/rws_causal_runtime.py` | 调度 PSM/Cox |
| `apps/agent/src/medtrust_agent/output_guard.py` | 扩展 `hazard_ratio`/`km_curve` 白名单 |
| **Agent 算法 (5.2/5.3)** | |
| `apps/agent/src/medtrust_agent/psm_iptw.py` | 站内 PSM/IPTW → `{ate, se}` |
| `apps/agent/tests/test_psm_iptw.py` | 对拍 sklearn/手算 |
| `apps/agent/src/medtrust_agent/cox_km.py` | Cox PH → `{log_hr, se}` + KM 分箱 |
| `apps/agent/tests/test_cox_km.py` | 对拍 lifelines 合成队列 |
| `apps/agent/pyproject.toml` | 增加 `lifelines`, `scikit-learn` |
| **输出闸门 (5.5)** | |
| `apps/connector/src/domain/km-gate.ts` | KM 分箱合并/尾部在险数抑制 |
| `apps/connector/src/domain/km-gate.spec.ts` | 黄金用例 |
| `apps/connector/src/domain/output-gate.ts` | L3 调用 `gateKmCurve` |
| **中心 meta (5.4)** | |
| `apps/api/src/runtime/rws-orchestrator/causal-effect-merge.ts` | `extractCausalSiteEffects` + merge |
| `apps/api/src/runtime/rws-orchestrator/causal-effect-merge.spec.ts` | HR/ATE meta 对拍 |
| `apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts` | `completeAssignment` 接 L3 |
| `apps/api/src/runtime/rws-orchestrator/rws-persistence.ts` | `mergePartyAggregates` 接 causal 类型 |

---

## Chunk 1: TTE 契约 (任务 5.6)

### Task 1: TTE 类型与校验

**Files:**
- Modify: `apps/api/src/compute-task/dto/rws-analysis-spec.ts`
- Create: `apps/api/src/compute-task/dto/rws-analysis-spec.spec.ts`
- Modify: `apps/connector/src/domain/types.ts`
- Modify: `apps/api/src/runtime/rws-orchestrator/types.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/compute-task/dto/rws-analysis-spec.spec.ts
import { validateTteSpec, type TteSpec } from "./rws-analysis-spec";

describe("validateTteSpec", () => {
  const valid: TteSpec = {
    exposureArm: "drug:A",
    comparatorArm: "drug:B",
    timeZeroRule: "index_date",
    inclusion: ["age>=18", "ckd_stage>=2"],
    exclusion: ["pregnancy"],
    outcome: { type: "time_to_event", event: "renal_failure", censoring: "administrative" },
  };

  it("accepts a complete TTE block", () => {
    expect(validateTteSpec(valid)).toBeNull();
  });

  it("rejects missing time zero", () => {
    expect(validateTteSpec({ ...valid, timeZeroRule: "" })).toMatch(/timeZero/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test -- rws-analysis-spec`
Expected: FAIL — `validateTteSpec` not exported.

- [ ] **Step 3: Add types + validation**

在 `rws-analysis-spec.ts` 增加:

```ts
export type CausalMethod = "psm" | "iptw" | "cox";

export interface TteOutcomeSpec {
  type: "time_to_event" | "binary";
  event: string;
  censoring?: "administrative" | "loss_to_followup";
}

export interface TteSpec {
  exposureArm: string;
  comparatorArm: string;
  timeZeroRule: string; // e.g. "first_prescription" | "index_date"
  inclusion: string[];
  exclusion: string[];
  outcome: TteOutcomeSpec;
  graceDays?: number;
  washoutDays?: number;
  matchingCovariates?: string[];
}

export interface RwsAnalysisSpec {
  // ...existing...
  type: string; // + "causal-psm" | "causal-survival"
  method?: CausalMethod;
  tte?: TteSpec;
}
```

`validateTteSpec(tte)` — `timeZeroRule`、`outcome.event` 非空;`inclusion`/`exclusion` 为数组。

同步 connector `RwsAnalysis` 与 orchestrator `RwsAnalysisSpec`。

- [ ] **Step 4: Run tests**

Run: `cd apps/api && pnpm test -- rws-analysis-spec`
Expected: PASS

- [ ] **Step 5: Commit (用户授权时)**

```bash
git add apps/api/src/compute-task/dto/rws-analysis-spec.ts apps/api/src/compute-task/dto/rws-analysis-spec.spec.ts apps/connector/src/domain/types.ts apps/api/src/runtime/rws-orchestrator/types.ts
git commit -m "feat(rws): L3 TTE spec fields and validation (task 5.6)"
```

---

## Chunk 2: 连接器→Agent in-TEE gRPC (任务 5.1)

### Task 2: Proto 契约

**Files:**
- Create: `packages/proto/rws_causal.proto`
- Modify: `apps/agent` grpc 注册(生成 stub 说明写入 `apps/agent/README` 或现有脚本)

- [ ] **Step 1: Define proto**

```protobuf
syntax = "proto3";
package medtrust.rws_causal.v1;

service RwsCausalAgent {
  rpc RunLocalCausal(RunLocalCausalRequest) returns (RunLocalCausalResponse);
}

message RunLocalCausalRequest {
  string task_id = 1;
  string method = 2;        // "psm" | "iptw" | "cox"
  string spec_json = 3;     // TteSpec + allowedArtifacts, no row ids
  string cohort_json = 4;   // [{ageBand, sex, followUpDays, event, treated, ...}]
}

message RunLocalCausalResponse {
  string ack_status = 1;      // "OK" | "FAILED"
  string result_json = 2;     // output-guarded safe envelope
  string message = 3;
}
```

`result_json` 形状(文档化于 proto 注释):

```json
{
  "analysisType": "causal-psm",
  "cohortSize": 1200,
  "effectEstimate": { "measure": "ate", "beta": 0.12, "standardError": 0.04, "ci95": [0.04, 0.20] },
  "kmCurve": null
}
```

Cox 时 `measure: "log_hr"`, 附 `kmCurve: { bins: [{ t, survival, atRisk, suppressed? }] }`。

- [ ] **Step 2: Agent stub + echo servicer (red→green)**

Create `rws_causal_servicer.py` 返回固定 `{beta:0.1,se:0.05}` 使连接器集成测试可先行。

Run: `cd apps/agent && pytest tests/test_rws_causal_servicer.py -v` (新建 echo 测试)

### Task 3: Connector gRPC client + TEE 执行器

**Files:**
- Create: `apps/connector/src/domain/causal/causal-agent-client.ts`
- Create: `apps/connector/src/domain/causal/causal-agent-client.spec.ts`
- Create: `apps/connector/src/domain/causal/causal-materializer.ts`
- Create: `apps/connector/src/domain/causal/causal-executor.ts`
- Modify: `apps/connector/src/domain/rws-executor.ts`
- Modify: `apps/connector/src/domain/connector-task-runner.ts`
- Modify: `apps/connector/package.json` — `@grpc/grpc-js`, `@grpc/proto-loader`(若未装)

- [ ] **Step 1: Failing client test**

```ts
// causal-agent-client.spec.ts — 使用 mock grpc Server 或 stub
it('RunLocalCausal returns parsed AggregateResult shape', async () => {
  const client = new CausalAgentClient('127.0.0.1:0', mockProto);
  const out = await client.runLocalCausal({ taskId: 't1', method: 'psm', spec: {}, cohort: [] });
  expect(out.effectEstimate?.measure).toBe('ate');
});
```

- [ ] **Step 2: Implement client**

`CausalAgentClient` 加载 `packages/proto/rws_causal.proto`, 默认 `process.env.AGENT_GRPC_URL ?? '127.0.0.1:5024'`。

**安全:** `cohort_json` MUST NOT 含 `subjectKey`/`patientId`; materializer 负责剔除。

- [ ] **Step 3: causal-executor in TEE**

```ts
// causal-executor.ts
export function runCausalInTee(
  tee: SoftwareSealedCompute,
  rows: InternalRecord[],
  analysis: RwsAnalysis,
  client: CausalAgentClient,
): AggregateResult {
  return tee.run(tee.seal(rows), (enclaveRows) => {
    const cohort = materializeCausalCohort(enclaveRows, analysis.tte!);
    return client.runLocalCausalSync({ ... }); // 仍在 enclave 回调内;agent 与本机同址
  }).output;
}
```

- [ ] **Step 4: Wire rws-executor + task-runner**

`rws-executor.run()`:

```ts
if (analysis.type === 'causal-psm' || analysis.type === 'causal-survival') {
  return this.causalExecutor.run(analysis);
}
```

`connector-task-runner`: 允许 `L3`; `L3` 必须 `type` 为 causal 之一。

- [ ] **Step 5: Integration test (mock agent)**

Run: `cd apps/connector && pnpm test -- causal-agent causal-executor connector-task-runner`
Expected: PASS

- [ ] **Step 6: Commit (用户授权时)**

```bash
git commit -m "feat(connector): L3 in-TEE gRPC to local causal agent (task 5.1)"
```

### Task 4: 扩展 InternalRecord 生存字段

**Files:**
- Modify: `apps/connector/src/domain/types.ts` — `InternalRecord` 增加 `followUpDays?: number`, `eventOccurred?: boolean`, `treated?: boolean`
- Modify: `apps/connector/src/domain/deidentifier.ts` — 确保无新标识符泄漏
- Modify: demo/ingest 路径(如 `local-store` 种子) — 合成 CKD 生存行供测试

- [ ] **Step 1:** 测试 `materializeCausalCohort` 输出无 `subjectKey`
- [ ] **Step 2:** 实现 materializer 按 TTE `inclusion`/`exclusion` 过滤(字符串表达式可先用白名单简化实现)

---

## Chunk 3: Agent PSM/IPTW (任务 5.2)

### Task 5: PSM/IPTW 估计核

**Files:**
- Create: `apps/agent/src/medtrust_agent/psm_iptw.py`
- Create: `apps/agent/tests/test_psm_iptw.py`
- Modify: `apps/agent/src/medtrust_agent/rws_causal_runtime.py`

- [ ] **Step 1: Failing test (synthetic RCT-like table)**

```python
def test_iptw_ate_matches_hand_calculation():
    # 构造已知 OR/ATE 的小表,N>=200
    result = estimate_iptw(cohort, covariates=["age_band", "sex"])
    assert abs(result["ate"] - 0.15) < 0.05
    assert result["standard_error"] > 0
```

- [ ] **Step 2: Implement `estimate_psm` / `estimate_iptw`**

- 倾向得分: logistic(`treated ~ covariates`)
- IPTW: ATE = weighted mean difference; SE = bootstrap 或 sandwich(文档注明方法)
- PSM: 1:1 最近邻,**站内**完成;输出 ATT 作为 `ate`

- [ ] **Step 3: output_guard 扩展**

拒绝 `result_json` 中含 `rows`, `subjectKey`, 原始协变量向量。

- [ ] **Step 4: Wire `rws_causal_runtime.run(method='psm'|'iptw')`**

Run: `cd apps/agent && pytest tests/test_psm_iptw.py -v`
Expected: PASS

- [ ] **Step 5: Commit (用户授权时)**

```bash
git commit -m "feat(agent): local PSM/IPTW ATE + SE for L3 (task 5.2)"
```

---

## Chunk 4: Agent Cox + KM 分箱 (任务 5.3)

### Task 6: Cox 偏似然 + KM 分箱

**Files:**
- Create: `apps/agent/src/medtrust_agent/cox_km.py`
- Create: `apps/agent/tests/test_cox_km.py`
- Modify: `pyproject.toml` — `lifelines>=0.27`

- [ ] **Step 1: Failing test vs lifelines**

```python
def test_cox_log_hr_on_synthetic():
    hr, se = fit_cox_ph(df, duration_col="follow_up_days", event_col="event")
    assert 0.2 < hr < 2.0
    assert se > 0

def test_km_bins_minimum_width():
    bins = kaplan_meier_binned(df, bin_width_days=30, min_at_risk=5)
    assert all(b["at_risk"] >= 5 or b.get("suppressed") for b in bins[-3:])
```

- [ ] **Step 2: Implement**

- `lifelines.CoxPHFitter` → `log(hr)`, `sqrt(var)` 为 SE
- KM: 固定宽度分箱(默认 30d);每箱 `t`, `survival`, `atRisk`;**agent 侧预分箱**,不在连接器出个体时间点

- [ ] **Step 3: Wire method `cox` in runtime**

返回:

```json
{
  "analysisType": "causal-survival",
  "effectEstimate": { "measure": "log_hr", "beta": -0.3, "standardError": 0.1, "ci95": [...] },
  "kmCurve": { "bins": [...], "binWidthDays": 30 }
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/agent && pytest tests/test_cox_km.py -v`

- [ ] **Step 5: Commit (用户授权时)**

```bash
git commit -m "feat(agent): Cox HR + binned KM for L3 (task 5.3)"
```

---

## Chunk 5: KM 输出闸门 (任务 5.5)

### Task 7: KM 尾部在险数 + 分箱抑制

**Files:**
- Create: `apps/connector/src/domain/km-gate.ts`
- Create: `apps/connector/src/domain/km-gate.spec.ts`
- Modify: `apps/connector/src/domain/output-gate.ts`
- Modify: `apps/connector/src/domain/types.ts` — `KmCurvePayload`

- [ ] **Step 1: Failing tests**

```ts
describe('gateKmCurve', () => {
  it('suppresses tail bins when atRisk < threshold', () => {
    const bins = [
      { t: 0, survival: 1, atRisk: 100 },
      { t: 360, survival: 0.7, atRisk: 3 }, // tail
    ];
    const out = gateKmCurve({ bins, binWidthDays: 30 }, 5);
    expect(out.bins[1].suppressed).toBe(true);
    expect(out.bins[1].atRisk).toBe(0);
  });

  it('merges adjacent bins when both below threshold', () => {
    // 可选: 合并而非仅清零,见 spec "分箱/合并"
  });
});
```

- [ ] **Step 2: Implement `gateKmCurve`**

常量: `DEFAULT_MIN_AT_RISK = 5`(与 `DEFAULT_MIN_CELL` 对齐,可参数化)。

- [ ] **Step 3: Integrate output-gate**

`analysisType === 'causal-survival' && agg.kmCurve` → `gateKmCurve`; 审计 `km-tail-suppression`。

若 HR 所依队列 `cohortSize < threshold` → 抑制 `effectEstimate`(复用 L2 stratum 模式)。

- [ ] **Step 4: Run tests**

Run: `cd apps/connector && pnpm test -- km-gate output-gate`

- [ ] **Step 5: Commit (用户授权时)**

```bash
git commit -m "feat(connector): KM tail at-risk suppression for L3 (task 5.5)"
```

---

## Chunk 6: 中心 Cox/ATE meta (任务 5.4)

### Task 8: causal-effect-merge + orchestrator 接线

**Files:**
- Create: `apps/api/src/runtime/rws-orchestrator/causal-effect-merge.ts`
- Create: `apps/api/src/runtime/rws-orchestrator/causal-effect-merge.spec.ts`
- Modify: `apps/api/src/runtime/rws-orchestrator/rws-persistence.ts`
- Modify: `apps/api/src/runtime/rws-orchestrator/rws-orchestrator.service.ts`

- [ ] **Step 1: Failing test (mirror comparative-effect-merge)**

```ts
describe('extractCausalSiteEffects', () => {
  it('maps log_hr and ate measures for meta', () => {
    const sites = extractCausalSiteEffects([
      { providerId: 'p-huashan', aggregate: { effectEstimate: { measure: 'log_hr', beta: -0.2, standardError: 0.08 } } },
      { providerId: 'p-ruijin', aggregate: { effectEstimate: { measure: 'log_hr', beta: -0.35, standardError: 0.1 } } },
    ]);
    expect(sites).toHaveLength(2);
    expect(sites[0].measure).toBe('log_hr');
  });
});

describe('mergeCausalEffectAggregates', () => {
  it('pools HR via MetaAnalysisService outcome', () => {
    // metaMerge merged:true → metaPooled.pooledHr = exp(pooledEffect)
  });
});
```

- [ ] **Step 2: Implement**

`extractCausalSiteEffects` — 读 `effectEstimate.beta`/`standardError`/`measure`(`log_hr`|`ate`)。

`mergeCausalEffectAggregates` — 镜像 `mergeComparativeEffectAggregates`; `pooledHr = Math.exp(pooledEffect)` when `log_hr`。

`rws-persistence.mergePartyAggregates`:

```ts
if (analysis.type === 'causal-psm' || analysis.type === 'causal-survival') {
  return mergeCausalEffectAggregates(analysis, aggregates, options?.metaMerge);
}
```

`completeAssignment` — 与 L2 相同模式:

```ts
if (analysis.type === 'causal-psm' || analysis.type === 'causal-survival') {
  metaMerge = this.meta.mergeSiteEffects(siteEffects, task.taskId);
}
```

- [ ] **Step 3: Orchestrator E2E test (two sites)**

Run: `cd apps/api && pnpm test -- causal-effect-merge rws-orchestrator.service`

- [ ] **Step 4: Commit (用户授权时)**

```bash
git commit -m "feat(api): L3 causal HR/ATE meta merge via MetaAnalysisService (task 5.4)"
```

---

## Chunk 7: 端到端冒烟 (组 7 预演,非本计划交付)

- [ ] 华山+瑞金各提交 `causal-survival` 任务 → connector demo 数据 → 过闸 → 中心 `metaPooled`
- [ ] 记录命令于 `REAL_DEMO_GUIDE.md`(可选,用户授权)

```bash
# 示意
cd apps/agent && python -m medtrust_agent.grpc_server &
cd apps/connector && pnpm demo:e2e  # 扩展支持 L3 scenario
cd apps/api && pnpm test -- causal-effect-merge
```

---

## 风险与决策记录

| 项 | 决策 | 备选 |
|----|------|------|
| OQ2 统计库 | `lifelines`+`sklearn` | 全手写 Cox(拒) |
| Proto | 新 `rws_causal.proto` | 挤进 `secretflow.proto`(污染 FL 契约) |
| 分析类型 | `causal-psm` + `causal-survival` 两类型 | 单类型 + `method` 字段 |
| Agent 部署 | 与连接器同机 sidecar `:5024` | API 远程 dispatch(违 D3) |
| KM 分箱 | agent 30d 等宽 + gate 尾部抑制 | 连接器内重算 KM(重复劳动) |
| TTE 表达式 | 首版字符串标签 + 简单解析 | 完整 DSL(过度) |

---

## 完成定义 (组 5 DoD)

- [ ] 5.6 TTE 字段在三处 DTO 一致且有校验测试
- [ ] 5.1 连接器能在 TEE 回调内 gRPC 调 agent,无 `subjectKey` 出域
- [ ] 5.2 PSM/IPTW 产出 `measure:'ate'` + SE,pytest 黄金用例
- [ ] 5.3 Cox 产出 `measure:'log_hr'` + 分箱 KM,pytest 黄金用例
- [ ] 5.5 output-gate 抑制 KM 尾部/小在险数,审计事件
- [ ] 5.4 双站 HR/ATE meta + 存证,orchestrator 测试绿
- [ ] `openspec/changes/rws-analytics-ladder/tasks.md` 组 5 全部勾选

---

## 执行 handoff

计划已保存:`openspec/changes/rws-analytics-ladder/plans/5-l3-causal-inference.md`

**建议执行入口:** Chunk 1 (5.6) → Chunk 2 (5.1) — 使用 @superpowers:executing-plans 或 subagent-driven-development,每 Chunk 完成后跑相关测试再进入下一 Chunk。

Ready to execute?
