## Purpose

定义数字合约的强制执行：策略执行点（PEP）在每次计算前校验合约、留存约束强制、分析分级授权、输出闸门（小单元格抑制 / 效应量与生存曲线保护 / 模型产物差分隐私）。是「授权后全程可控」的落点。
## Requirements
### Requirement: 使用控制强制执行数字合约
使用控制 SHALL 是数字合约([[digital-contract]])的强制执行机制(对齐 TC609-6-2025-15《可信数据空间 使用控制技术要求》)。连接器策略执行点(PEP)MUST 依据生效数字合约的目的/留存/输出约束校验每次计算;无生效数字合约时任务 MUST 被拒绝。

#### Scenario: 无生效数字合约则拒绝
- **WHEN** 一个计算任务未关联任何生效的数字合约
- **THEN** 连接器 MUST 拒绝执行并记录审计

### Requirement: 授权产物为可强制执行策略
授权 SHALL 表示为一份可强制执行的使用控制策略,至少包含:目的限定、留存约束、输出约束、有效期。一次性审批 MUST NOT 作为授权的唯一形式。

#### Scenario: 策略生成
- **WHEN** 数据提供方批准一次数据使用申请
- **THEN** 系统 MUST 生成一份包含目的/留存/输出/有效期的使用控制策略,并下发到相关连接器

#### Scenario: 策略哈希存证
- **WHEN** 一份使用控制策略生效
- **THEN** 其哈希 MUST 上链存证,以便后续审计比对

### Requirement: 策略执行点(PEP)强制校验
连接器 SHALL 在每次计算任务执行前由策略执行点校验该任务是否符合生效策略；不符合的任务 MUST 被拒绝执行。当生效合约为任务的分析类型固定了算法模块时，任务派发记录携带的模块 SM3 MUST 与合约固定值一致，否则 MUST 拒绝执行。

#### Scenario: 目的不符被拒
- **WHEN** 一个计算任务声明的目的与策略的目的限定不一致
- **THEN** 连接器 MUST 拒绝执行并记录审计

#### Scenario: 策略过期被拒
- **WHEN** 一个计算任务在策略有效期之外发起
- **THEN** 连接器 MUST 拒绝执行

#### Scenario: 固定模块不符被拒
- **WHEN** 合约为 `disproportionality` 固定了模块 SM3，而任务派发记录携带的模块 SM3 与之不同
- **THEN** 连接器 MUST 拒绝执行并记录 `pep-deny` 审计

#### Scenario: 合约固定了模块但任务未携带
- **WHEN** 合约为该分析类型固定了模块，而任务派发记录没有携带模块引用
- **THEN** 连接器 MUST 拒绝执行，MUST NOT 以内置实现代替

### Requirement: 留存约束强制
连接器 SHALL 按策略的留存约束处置任务相关的中间数据;声明为"阅后即焚"的,中间数据 MUST 在任务结束后销毁。

#### Scenario: 阅后即焚
- **WHEN** 一个留存约束为"阅后即焚"的任务执行完成
- **THEN** 连接器 MUST 在任务结束后删除该任务产生的所有中间数据

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

### Requirement: 预先指定字段的冻结强制

`usage-control` SHALL 把既有的 `allowedArtifacts` 白名单强制从"授权边界"扩展为"预先指定边界"：`allowedArtifacts` 与 `matchingCovariates`（倾向评分变量）在任务派发后 MUST 不可变。

理由：《指导原则》附1·2 监管要点明示"预先指明用于构建倾向评分模型的变量，避免为获得'理想'或'预期'结果而反复调整倾向评分模型"。反复调整 PS 模型从最终产物上不可见，唯一有效的控制点在事前冻结。

#### Scenario: 派发后改 PS 变量被拒
- **WHEN** 一个已派发任务尝试修改 `matchingCovariates`
- **THEN** PEP MUST 拒绝该变更，任务 MUST 继续以冻结时的变量集执行

#### Scenario: 派发后扩大产物范围被拒
- **WHEN** 一个已派发任务尝试向 `allowedArtifacts` 追加类别
- **THEN** PEP MUST 拒绝，MUST NOT 允许新类别的产物出域

### Requirement: 敏感性分析全报强制

`usage-control` SHALL 在结果出具前对账：规格中**声明**的每一项敏感性分析，其结果 MUST 全部随主分析回传。存在声明但未回传的项时，结果 MUST NOT 出具（fail-closed）。

理由：《指导原则》§3.5 要求"完整报告所有敏感性分析结果"，且结果与主分析不一致时须探讨原因。选择性省略不一致项是最隐蔽的报告偏倚。本约束把"不可见的省略"转化为"可见的少声明"。

#### Scenario: 声明三项回传两项被阻断
- **WHEN** 某任务声明了三项敏感性分析，但回传结果只含两项
- **THEN** 系统 MUST NOT 出具该任务结果，并指出缺失的那一项

#### Scenario: 声明与回传一致则放行
- **WHEN** 声明的全部敏感性分析结果均已回传
- **THEN** 结果 MUST 正常出具

#### Scenario: 未声明敏感性分析不受此约束
- **WHEN** 某任务未声明任何敏感性分析
- **THEN** 本约束 MUST NOT 阻断结果出具（少声明是可见的，由评审判断）

### Requirement: 分析分级授权
数字合约([[digital-contract]])的目的与输出约束 SHALL 限定允许的分析层级(L1 / L1.5 / L2 / L3 / L4)与允许的输出产物类别(`allowedArtifacts`);连接器策略执行点(PEP)MUST 拒绝任何超出合约允许层级或产物类别的任务。

#### Scenario: 安全监测合约不允许模型训练
- **WHEN** 一个数字合约的目的限定为"上市后安全监测"、允许层级至多 L1.5
- **AND** 一个 L4 预测建模任务引用该合约
- **THEN** 连接器 PEP MUST 拒绝该任务并记录审计

#### Scenario: 产物类别越界被拒
- **WHEN** 一个任务请求输出的 artifact 类别不在合约 `allowedArtifacts` 白名单内
- **THEN** 连接器 PEP MUST 拒绝该任务并记录审计

