# 任务 3.4 对拍：`rws.algorithm-validation`

出域估计是 Mann–Whitney AUC、Hanley 标准误、五箱校准和九点决策曲线。定点模块与 `validationMetricsQ16` 逐字段相等。

模块 SM3：`b377d889f6b8e690ada3681eaacd9533171f6f425ed4b2aa9875e9ab82b8f91c`。

## AUC

四行夹具：阳性分数 0.75 与 0.25，阴性分数 0.5 与 0。三对一致、零对并列，AUC 定点值是 49152/65536，等于 0.75。Hanley 标准误与同一公式的浮点结果相差小于 0.001。

样本量、阳性数或阴性数低于 `minCell` 时不交出 AUC，也不把 0.5 当成占位值。

## 校准与决策曲线

分数按 `floor(score * 5 / Q)` 落入五箱。箱人数低于 `minCell` 时人数、事件数和均分都写成 0。决策曲线取阈值 0.1 到 0.9；预测阳性数低于 `minCell` 的点不交出净获益。平台若收到未抑制、但人数仍低于声明阈值的箱，拒绝合并。校准箱和决策曲线按站附上，不跨站合并。

## 与旧通道的差别

旧执行器拿识别语法对照金标准，交出 2×2 混淆矩阵和 Wilson 区间的敏感度、特异度、阳性预测值、阴性预测值。它不算 AUC、校准或决策曲线。两条路径的数字不能对拍，出域以这一组定点指标为准。

## 通道

新建页调用 `POST /mdop/jobs/algorithm-validation`。台账 `channel=mdop`、`state=migrated`，没有 `cutoverAt`。旧的混淆矩阵执行器留到 O7（任务 4.3）。
