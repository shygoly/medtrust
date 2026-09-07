## ADDED Requirements

> Delta 说明：本文件叠加于未归档 change `federated-data-space-rws` 与 `rws-analytics-ladder` 定义的 `usage-control`，归档时统一 reconcile。本 change 对既有闸门规则**无修改**，仅新增，故全部使用 ADDED。

### Requirement: `validation_metrics` 产物类别

`usage-control` 的 `allowedArtifacts` 白名单 SHALL 新增 `validation_metrics` 类别，承载算法准确性指标。数字合约未授权该类别时，验证任务的产物 MUST NOT 出域（复用既有产物白名单强制路径）。

分析分级授权 SHALL 新增 `L0` 层级，与既有 L1.5–L4 同等参与合约授权校验。

#### Scenario: 未授权 validation_metrics 被拒
- **WHEN** 一个验证任务的合约 `allowedArtifacts` 不含 `validation_metrics`
- **THEN** 连接器 MUST 拒绝该产物出域

#### Scenario: L0 越权被拒
- **WHEN** 一个 L0 任务请求的分析层级超出合约 `allowedLevels` 范围
- **THEN** 连接器 MUST 拒绝执行

### Requirement: 混淆矩阵抑制联动 —— 指标全有或全无

输出闸门 SHALL 对混淆矩阵套用既有小单元格抑制阈值（`DEFAULT_MIN_CELL`）。**当 TP / FP / TN / FN 中任一格被抑制时，该算法的全部准确性指标 MUST NOT 出域**——MUST NOT 只放行未受该格影响的指标，MUST NOT 用被抑制的格重算任何指标。

理由：四个指标共享同一组计数，部分放行会诱导使用者用残缺数据做整体判断。此为 D-UC-2「出域前关键义务同步 fail-closed」的应用。

#### Scenario: 单格抑制导致全部指标被阻断
- **WHEN** 某验证任务的 FN 计数低于抑制阈值
- **THEN** 输出闸门 MUST 阻断 Se / Sp / PPV / NPV 全部四个指标出域

#### Scenario: 抑制原因可区分于算法表现差
- **WHEN** 验证结果因小单元格抑制而未出具
- **THEN** 返回结果 MUST 明确标注"因样本量不足抑制"，MUST NOT 呈现为准确性低或算法失败

#### Scenario: 抑制事件留痕
- **WHEN** 输出闸门抑制了混淆矩阵的任一格
- **THEN** 该抑制动作 MUST 记入本地审计日志（与既有抑制留痕一致）

### Requirement: 算法定义作为入站载荷的安全校验

`usage-control` SHALL 在算法定义进入连接器时做闭合语法校验：仅允许 `AND` / `OR` / `NOT`、编码集成员判定与时间窗约束。任何超出闭合语法的构造（内联脚本、函数调用、动态求值）MUST 被拒绝，且 MUST NOT 被求值。

理由：连接器是唯一能接触原始数据的部件，来自消费方的算法定义是跨域入站载荷（`crosses: control→connector`，`payload: task-spec`），通用表达式求值会构成注入面与不可预测的计算成本。

#### Scenario: 内联脚本被拒且不求值
- **WHEN** 一个算法定义中含内联脚本或函数调用构造
- **THEN** 连接器 MUST 在求值前拒绝该任务，MUST NOT 执行该构造

#### Scenario: 合法闭合语法通过
- **WHEN** 一个算法定义仅由布尔组合、编码集判定与时间窗约束构成
- **THEN** 校验 MUST 通过并进入执行
