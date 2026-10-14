# L4 联邦预测迁移的等价性证据（闸门①）

> 批次 1A（change `mdop-fl-migration`）。**两类对拍，标准不同，别混**（design D1d §4）。

## 1. wasm(定点) vs TS(同一算法) —— **逐字段相等**

- 模块：`packages/wasm-algorithms/modules/fl-logistic-as/assembly/fl-logistic.ts`
- TS 孪生体：`packages/wasm-algorithms/src/fl-logistic-model.ts#trainFlLogisticQ16`
- 对拍：`packages/wasm-algorithms/scripts/fl-logistic-parity.test.mjs`（已挂进包默认测试链）
- 复现：`cd packages/wasm-algorithms && pnpm test`

**结果（2026-10-13 实测）**：`# tests 5 · pass 5 · fail 0` ——
可分数据 / 非可分带噪（会产生负梯度）/ 单特征全正标签（退化）/ **宿主自定义查表** / 非法入参错误码（n=0→1、d=0→2、域非法→3、outOff 越界→4）全部逐字段一致。

**产物可复现**：`fl-logistic.wasm` 930 bytes，**SM3=`3137d92c5a4bb24d3d871e9c9408b20ee7e57b94e3986cd7a1a587d431d8d21c`**，
`check-reproducible` 源码重建**逐字节一致**、只导入 `env.memory`（零能力）。

## 2. 定点 vs 浮点 IRLS（旧链参考）—— **容差**

- 复现：`cd apps/connector && npx jest src/domain/fl-prediction/local-logistic-fixedpoint.proto.spec.ts`
- 实测（同一夹具同一超参）：

| 数据集 | aucFloat | aucFixed | \|Δauc\| | max\|Δθ\| | 符号一致 |
|---|---|---|---|---|---|
| 200 例（可分） | 0.9177 | 0.9177 | **0.0000** | 0.0273 | 9/10 |
| 4000 例（低事件率，线上 AUC 0.418 那次出事的队列） | 0.8328 | 0.8328 | **0.0000** | 0.0071 | 9/10 |

唯一符号不一致的是 `sex=male`（浮点 +0.0093 / 定点 −0.0053，两者都≈0，噪声底）。

**结论**：定点替换**不损失 AUC**（4 位小数一致）；系数偏差 ≤0.03 且只出现在噪声底系数上。

## 3. 注册与提交链路（3.0 → 平台可提交）

`apps/api/src/mdop/l4-fl-e2e.spec.ts` 的里程碑用例：用**真实** `AlgorithmModuleRegistry` 读
`packages/wasm-algorithms/build/manifest.json`（按 SM3 校验）→ `rws.l4-train@1.0.0` 以
**`kind: wasm`** 登记 → `MdopJobsService.submit(buildL4Plan(...))` **成功**。
无模块时的拒绝路径作为回归保留。

## 尚未覆盖（如实列出）

- **经连接器 sandbox 实跑**：连接器算子 `mdop/operators/l4-train.ts`（task 3.1）尚未接线，
  因此"模块在真实作业里跑一遍"还没有证据。
- **端到端 L4 作业**（平台→片段→连接器→C3→合并）与 `retained` 的 TS 参考实现联动验证。
- **多轮/多院**：当前 ABI 一次调用完成本地训练；跨院轮次语义见 design D3（1A 不新增节点→平台通道）。
