# 设计：节点侧沙箱走 S2（TD-12 第三刀）

## D1 为什么不是「搬文件」

勘察证据：4 个 sandbox 各导出四件套（`projectX` / `XRequiredBytes` / `XFromSandboxOutput` / `XPayload`），
runner 中对应四段执行分支（约 250 行）与各自的投影/聚合类型耦合；`wasm-runner.ts` 的注释明确写着三条
出域规矩钉在「唯一入口」这一处。搬走分支 = 把出域判据搬进行业包，属安全回归。

## D2 形态：宿主适配器 + 单入口 `runStage`（选 S-B）

两种候选：

- **S-A**：SPI 只暴露四件套成员，基座保留四段分支 → 基座仍需引用各分析的**类型**（类型在包里），
  被迫 `unknown` 铺路，可读性与判据集中度都变差。
- **S-B（选它）**：**每个分析一整段**搬进包，以 `StageSandbox.runStage(stage, host)` 暴露；
  `host` 是**基座提供的适配器接口**，承载三条出域规矩与必要的执行原语（取模块字节、调沙箱、脱敏错误、
  校验编码白名单与分层键）。基座退化为薄分派器 ✅，出域判据**按构造**留在基座 ✅，
  包的实现只能经 `host` 拿到「已被判据放行」的输入。

`StageSandbox` 的形状（SPI，零领域语义、输入输出 `unknown`）：

```ts
export interface StageSandbox<O = unknown> {
  readonly analysisType: string;
  runStage(stage: unknown, host: SandboxHost): Promise<O>;
}
```

## D3 组装根与单测装配

注册在 `apps/connector/src/app.module.ts`（非基座）；单测走 jest `setupFiles`（与第二刀同源手法）。
解析不到 → fail-closed（不静默、不回退内置实现）。

## D4 出域判据的「不动清单」

以下三条 MUST 留在基座，且 MUST 各有一个**负例**用例（现有出域用例须逐条保留）：

1. **错误文案不带数据**：非 `MdopError` 一律只进节点本地日志，对外固定文案；
2. **编码白名单参数**：给了就必须是非空字符串数组，否则拒（不得被当成「不过滤」）；
3. **分层键闭合语法**：`strataKeys` 与结果里的每个层键都须符合 `isStratumKey`，否则本阶段失败。

## D5 等价性判据

搬移前后：同一夹具的阶段输出**逐字段相等**；connector 全量（136 套件 / 909 用例）全绿；
三条出域负例仍在；棘轮 205 → ≤181。

## D6 顺序（每步可独立验证）

SPI 缝 → 基座宿主适配器与薄分派（行为不变）→ 包内实现与注册 → 组装根/单测装配 → 三重闸 → 治理同步。
