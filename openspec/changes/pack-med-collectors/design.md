# 设计：聚合收集器走 SPI（TD-12 第二刀）

## D1 反转，而不是搬文件

**证据**（2026-10-14 勘察，逐候选查引用方）：`collect-paired-cohort.ts`(21) / `collect-vaccine-scri.ts`(12) 的唯一调用点是
`mdop-merge.service.ts:26-27`；connector 的 4 个 sandbox(24) 由 `tee-node/wasm-runner.ts:40-58` 引用；`plan-templates.ts`(49)
由 `mdop.controller.ts` 引用；`participant-aliases.ts`(3) 由 `attestation-ledger.service.ts` 引用。**调用方都在基座目录**。
`scanKernelPurity` 的 `importViolations` 会把「基座文件 import 含 `industries/med` 的说明符」记为违规，所以直接搬只会换一种违规形式。

## D2 扩展 S2，而不是新开第七根缝；且接口放 SPI 包

两件事：

1. **缝的数量是机检事实**：SPI 明确是「六根 S1–S6」（`KERNEL.md` §3 的表 + `scripts/conformance/check-pack.mjs`
   按缝名对拍）。为平台侧聚合新开第七根，等于要同时改治理文档与一致性套件——收益不抵改动面。
   正确做法是把平台侧聚合挂到 **S2 算子包**上：`declareCollectors?(ctx)` 是**可选**成员，
   不声明的包保持既有行为；`OperatorPack` 接口名不变，两份治理文档只列接口名不列成员，故无需改动。
2. **接口放 SPI 包**：若定义在基座（`apps/api/src/mdop/...`），行业包要落地就得 import 应用内部路径（跨包相对路径 / 不可达）。
   放 `@medtrust/space-kernel-spi` 才满足依赖方向「包 → SPI → 基座」，并保持「SPI 零依赖、零领域语义」
   （输入输出默认 `unknown`，SPI 只说怎么声明/怎么解析）。

## D3 注册点在组装根，且**不改 `MdopMergeService` 构造签名**

注册发生在**非基座**的 `apps/api/src/app.module.ts`；`MdopMergeService` 仍是无参新增依赖的类（构造签名不变），
以 `resolveCollector(type)` 取值。这样 30+ 个直接 `new MdopMergeService(...)` 的基座 spec 不受影响（它们只需在用例里
注册所需收集器，spec 不在扫描范围）。若改成 Nest 注入 token，改动面会扩散到所有直接 `new` 的用例，收益不抵风险。

## D4 未知分析类型 fail-closed

注册表解析不到时 MUST 抛明确错误（含类型名与已注册清单），MUST NOT 回退到某个默认收集器、MUST NOT 静默产出空结果
（否则「少收一家院」会变成「静默给出错误结果」）。

## D5 等价性判据

搬移的是**同一函数体**（逐字节），`mergeFlPartyResults` 与 `collect-*` 的算法/字段顺序不变。
判据：既有的 `mdop-collect-paired.spec.ts`、`c2-multi-node-e2e.spec.ts`、`l4-fl-node-e2e.spec.ts` 逐字段通过；
并在证据档记录「搬移前后同一夹具输出相等」。

## D6 棘轮当进度表

本变更的验收包含**计数下降**（246 → ≤213，随基线重生成）。只搬不改口径，所以计数下降是「真的搬走了行业代码」的直接证据。

## D7 顺序（每步独立可验）

SPI 缝隙 → 基座注册表 + merge 改解析 → 包内实现与注册函数 → 组装根注册与依赖 → 测试与棘轮 → 治理同步。

## 风险

| 风险 | 缓解 |
|---|---|
| 搬移改变了合并行为 | D5 等价性三闸 + 只改解析方式不改算法 |
| 组装根忘记注册导致运行期 fail-closed | 组装根注册有专门用例；「未知类型 MUST 抛错」让缺注册**立刻可见**，不会静默 |
| 半截反转（基座仍 import 行业包） | 棘轮 + `pnpm test` 链拦下；任务按步提交，每步跑棘轮 |
| 包构建/装配顺序 | 照 `packages/mdop` 的既有模式（`pretest` 先构建依赖包） |
