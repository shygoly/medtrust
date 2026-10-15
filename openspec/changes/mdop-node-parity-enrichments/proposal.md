# MDOP 节点补齐旧链的「分析/证据侧」语义（删旧接线的前提）

## 为什么

逐型删旧接线时发现：旧 `RwsExecutor` 在返回聚合前会做两类**分析/证据侧**处理，而 MDOP 节点路径不做 ——
直接删旧分支就会**丢能力**（且其中两项有 spec/判据强制）。已实测确认三例（见 `mdop-rws-ladder-migration` D10.5/D10.6）：

1. **协议队列收窄**：`analysis.tte` 的纳入/排除（`cohort-definition-gap.spec` 验到 `cohortSize` 由 3 → 1）；
2. **缺失值处理 + `missingnessLog`**：SAP 声明缺失机制/插补策略时，必须先应用再计数，并把日志挂到聚合上
   （`missingness.spec.ts` 断言 MUST defined，且策略要**逐字**记录以便与 SAP 对账；同时守住「不得静默退化为完全病例」红线）；
3. 逐变量缺失率审计/质量报告（L1.5-data-audit）——**已在 `mdop-rws-ladder-migration` 移植**（适配器 `enrich` 端口）。

## 做什么

把 1、2 搬到 MDOP 路径：

- **声明如何到达节点**：任务的 `analysis`（协议队列 `tte` / `missingness`）由平台编译进计划的阶段参数，
  节点侧在**取数/投影之前**应用，并保持封存口径（行不出回调）；
- **日志随聚合出域**：`missingnessLog` 与 `dataAudit`/`qualityReport` 同层挂载（后者已有端口）；
- **对拍**：与 `retained(test-reference)` 的旧实现逐字段比（队列规模、各分类计数、日志字段）；
- 完成后，`cohort-count` / `condition-prevalence` / L1.5 的连接器侧旧分发才可逐型删除。

## 不做什么

- 不改缺失值处理的**语义**（策略分类、逐字记录、红线都照旧）；
- 不改 ABI（那是另一个 change：`mdop-categorical-count-u16`）；
- 不动 api 侧已完成的登记（`legacyRefs` 第 2 条已删）。

## 影响

计划里多两个可选参数（队列定义、缺失值声明）；节点侧多一步预处理与其证据字段。删除旧接线前，
台账不置 `legacy-removed`（守护的观察窗也还没到）。
