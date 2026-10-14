# 单臂试验真实世界外部对照（D1 × 可信空间）

## Why

单臂试验（罕见病药、乐城特许先行先用的药械）常拿不到随机对照：历史对照就躺在医院里，
但外部对照需要**患者级匹配**——同层（年龄×性别）、索引日相近（诊断窗 caliper）的对照逐人配对，
再比较 90 天结局。任何一方单独都做不了（申办方没有医院历史病例，医院没有试验数据）；
聚合式/联邦方法做不了匹配（匹配需要两侧个体记录在同一处）；MPC 做逐对比较代价不可接受。
TEE（C2）可以：申办方与医院各封最小投影进 TDX，节点内确定性匹配并计数，只出过闸聚合（C3）。

这是乐城主线场景（真实世界数据支持注册的典型路径：单臂 + 真实世界外部对照）。

## What Changes

- 新增算子 **`rws.external-control@1.0.0`**（975B，SM3 随构建产出、可复现构建）：
  同层确定性 1:k 窗口匹配，输出逐层 `{mExpPos, mExpNeg, ctlPos, ctlNeg, matched, unmatched}`；
  排序契约破坏返回 6（宁可拒绝也不悄悄算错）。
- 两方最小投影：申办方 `sponsor-trial`、医院 `hospital-controls`
  （`{subjectKey: linkKey, ageBand, sex, indexDate, outcome}`；缺索引日/结局非法即不出院）。
- 沙箱 ABI `external-control@1`；执行器分支 + 三层不变量
  （匹配+未匹配=受试者数 / 匹配组计数=matched / 对照 ≤ k×matched）。
- 宿主侧估计：RR、RD + 95% CI（Woolf；零事件格 Haldane-Anscombe 校正并标注）；
  **不可估语义**：matched=0、对照=0 或任一侧零事件 → 显示「不可估计」，MUST NOT 显示 0/∞。
- 数据生成器 `scripts/build-external-control-records.mjs`（Synthea 基座 + 注入 RR）+ 答案键（按投影后形状计算）。

## Impact

- `packages/wasm-algorithms/`：新模块/参考模型/对拍（7 项）/清单登记（collab · tee · 双 C2 输入）。
- `apps/connector/`：`seal.ts` 两方投影、`sandbox-runner.ts` ABI 白名单、`wasm-runner.ts` 执行分支与不变量。
- `scripts/`：数据生成器；`data/demo/external-control/`。
- 物料：`pitch/dr-showcase-20261003/`（运行 JSON + 截图）；药物注册向 deck 第 6 页。
