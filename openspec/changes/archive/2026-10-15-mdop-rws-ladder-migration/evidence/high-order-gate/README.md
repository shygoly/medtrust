# 任务 3.5 复核：高阶统计量输出闸门

口径来自 `rws-compute`：效应量所依据的分层样本量低于阈值时，抑制该效应量；生存曲线按箱交出，在险人数低于阈值的箱不交出生存率，也不交出真实人数。四型的站内模块都先做这道闸门，平台再拒绝「未抑制但人数仍低于声明阈值」的载荷。

## 比较效果

`minCell` 写进站内阶段参数，默认 5。人数不足的分层在调用定点模块之前剔除，效应量只来自留下的层。被剔除的层人数写成 0 并标 `suppressed`。全部分层都被剔除时不调用模块，也不交效应量。

夹具：`40-49` 五行留下，`50-59` 三行剔除。留下的效应量等于只对这五行算出的定点值。用例：`apps/connector/src/domain/comparative-effect.spec.ts`「人数低于阈值的分层不进入效应量，也不交出该层人数」。平台拒绝未抑制的小分层：`apps/api/src/mdop/comparative-effect-plan.spec.ts`。

## 倾向评分

层内样本量（IPTW）或配对数（PSM）低于 `minCell` 时，该层不进入 ATE。配对数不足 2 时整站抑制，不把 0 送进合并。用例：`packages/wasm-algorithms/scripts/causal-ate-parity.test.mjs`「层内样本量低于阈值则整站抑制，不交出 0 效应冒充结果」。

## 生存分析

事件数低于 `minCell` 或信息量为 0 时抑制 log HR。生存曲线按箱取左端点；在险人数低于 `minCell` 的箱把生存率和在险人数都写成 0。用例：`apps/connector/src/domain/causal/causal-survival.spec.ts`「log HR 等于定点参考，尾箱不交出真实在险人数」。

## 算法校验

样本量、阳性数或阴性数低于 `minCell` 时不交出 AUC。校准箱人数或某一阈值的预测阳性数不足时，该箱或该点不交人数和指标。用例：`packages/wasm-algorithms/scripts/validation-metrics-parity.test.mjs`「样本量低于阈值时不交出 AUC，小校准箱不交出人数」。
