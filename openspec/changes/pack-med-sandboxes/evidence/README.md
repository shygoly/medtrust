# 证据：节点侧沙箱走 S2 —— 竖切 ve-tnd（2026-10-14）

本轮只做**一条竖切**（rws.ve-tnd@1.0.0），把 S-B 形态、宿主适配器与三重闸先跑通；
其余三条（pairing / scri / dedup-incidence）按同一形态接入。

## 1. 形态落地

- **SPI**：StageSandbox / SandboxHost / SandboxRunRequest / SandboxRegistry + OperatorPack.declareSandboxes?（仍不新开缝）。
- **基座**：apps/connector/src/tee-node/sandbox-registry.ts（域中立）+ wasm-runner.ts 内的 buildSandboxHost；
  分派处先查注册表，未注册则回落内置分支（未迁移算子行为一字不变）。
- **包**：industries/med/src/sandboxes/（ve-tnd-sandbox.ts 搬运 + ve-tnd.ts 的 runStage），
  由 medSandboxes() / registerMedSandboxes() 声明；组装根 apps/connector/src/app.module.ts 注册，
  单测经 jest setupFiles（apps/connector/src/test/register-sandboxes.ts）同源注册。

## 2. 三条出域判据仍在基座（不动清单的落实位置）

| 判据 | 留在哪 |
|---|---|
| 错误文案不带数据 | createNodeWasmRunner 的统一 try/catch（非 MdopError 只进本地日志，对外固定文案） |
| 编码白名单参数 | buildSandboxHost.codeWhitelist 闭包到 optionalCodeWhitelist（包只能调宿主的） |
| 分层键闭合语法（入参侧） | buildSandboxHost.strataKeys 闭包到 checkedStrataKeys |
| 分层键闭合语法（结果侧） | createNodeWasmRunner 里对 produced.payload 的 assertResultStratumKeys 复校 |

三条执行前判据（算子白名单 / op_digest 核对 / 模块字节）也仍在 createOperatorDispatch。

## 3. 等价性与纯度

- 搬移的 sandbox 实现：**SAME（逐字节同体）**（与 git HEAD 里的原文件比对，去掉新增的 2 行 SPDX 头）。
- **连接器全量：136 套件 / 909 用例通过**（3 跳过），ve-tnd-sandbox.spec.ts 5/5。
- check-kernel-purity：importViolations = 0；目标布局越界 227 → **223**；棘轮基线 205 → **201**。

## 4. 仍未做

- pairing(16) / scri(2) / dedup-incidence(4) 三条及它们在 runner 里的执行分支（同一形态）；
- plan-templates.ts(49) + mdop.controller.ts(16)（需要模板注册缝，且 DTO 级联，另立一刀）。

---

## 5. 第二锯：pairing / scri / dedup-incidence（2026-10-14，四条已全部接入）

### 5.1 落地

- 包：`sandboxes/{pairing,scri,dedup-incidence}.ts` 三条 `runStage`；`medSandboxes()` 现返回四条；
  分析专用助手 `flattenDedupCohorts` **随包搬走**（只被去重用）。
- 宿主新增两个原语：`tables(stageInput)`（行提取留在基座）与 `configuredStrataKeys(source)`（节点配置的分层键，
  同样走判据 3 校验）——跨院配对用的是节点配置而不是阶段参数，必须由宿主给。
- 内核：删掉内联的 pairing 分支与 `runVaccineScri` / `runDedupIncidence` / `flattenDedupCohorts` 三段及全部静态 import；
  分派尾部补**显式 fail-closed**（原来末位分支被搬走后会漏 `undefined`，现在抛 `E_CAPABILITY_MISMATCH`）。

### 5.2 两处必须记下的坑（都已修，非纸面）

1. **`MdopError` 语义不能降级**：包内的角色绑定/参数形状校验若改抛普通 `Error`，会被基座统一入口的**出域脱敏**
   换成固定文案（平台看不到原因）——那是行为回归。已全部改回 `MdopError('E_RUNTIME', …)`，与搬移前一致。
   （为此 med 包新增 `@medtrust/mdop` 依赖。）
2. **末位分支搬走后必须显式兜底**：分派链原来靠最后一段 pairing 分支兜底，搬走后 TypeScript 立刻指出
   「可能返回 undefined」；补的 throw 正好把 spec 里「未知算子 fail-closed」的要求落成代码。

### 5.3 验收

- 搬移的三个 sandbox 实现**逐字节同体**（去 2 行 SPDX 头后 `diff -q`）：
  pairing-sandbox: SAME
  scri-sandbox: SAME
  dedup-incidence-sandbox: SAME
- **连接器全量：136 套件 / 909 用例通过**；四个 sandbox 用例 4 套件 / 19 用例通过。
- `check-kernel-purity`：`importViolations = 0`；目标布局 223 → **185**；棘轮基线 201 → **163**。

### 5.4 TD-12 累计

| 阶段 | 棘轮（候选布局） | 目标布局越界 |
|---|---|---|
| 起点 | 246 | 268 |
| 第一刀（平台侧收集器） | 205 | 227 |
| 第三刀第一锯（ve-tnd） | 201 | 223 |
| 第三刀第二锯（pairing/scri/dedup） | **163** | **185** |

### 5.5 仍未做

- `plan-templates.ts`(49) + `mdop.controller.ts`(16)：医疗计划模板需要**模板注册**缝，且依赖的 DTO
  （`fl-prediction-task-spec.ts` 等）本身也是行业件，级联更大，另立一刀。
