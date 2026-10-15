# 任务 3.3 对拍：`rws.causal-survival`

出域估计是单协变量 Cox 在 β=0 处的一步 Newton，加上按天分箱的 Kaplan–Meier。定点模块与 `survivalEffectQ16` 逐字段相等。

模块 SM3：`c763942433989364f085913a497ee29e16895882329996e82003990a9c76e184`。

## Cox

平衡夹具：第 10 天处理组、对照组各 2 起事件，第 30 天各 2 人删失。log HR 的定点值是 0，标准误的定点值是 1，与 `score/info` 闭式一致。

单侧夹具：第 5 天 2 名处理组事件，第 40 天 2 名对照组删失。闭式 log HR 是 2，标准误是 `sqrt(2)`。定点结果与这两个数相差小于 0.001。

旧通道在装了 lifelines 时做的是完整迭代偏似然。那和 β=0 的一步 Newton 不是同一个估计，出域数字以这一步为准。事件数低于 `minCell` 或信息量为 0 时抑制 log HR，不交占位值。

## 生存曲线

箱取左端点，不含当天的事件。在险人数低于 `minCell` 的箱把生存率和在险人数都写成 0，并标 `suppressed`。平台若收到未抑制、但在险人数仍低于该曲线声明阈值的箱，拒绝合并。

平衡夹具、箱宽 30、`minCell = 1` 时，第 30 天的生存率定点值是 38416/65536，等于 `(7/8)^4`。

## 通道

新建页调用 `POST /mdop/jobs/causal-survival`。台账 `channel=mdop`、`state=migrated`，没有 `cutoverAt`。旧的 lifelines 路径留到 O7（任务 4.3）。
