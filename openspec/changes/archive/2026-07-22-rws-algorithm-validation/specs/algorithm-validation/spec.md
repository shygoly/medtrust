## ADDED Requirements

### Requirement: 识别算法为一等对象

`algorithm-validation` SHALL 以结构化对象承载变量的**操作性定义**（《指导原则》§2.1）。识别算法 MUST 由编码集（`CodeSet`）与布尔组合规则构成；每个编码集 MUST 声明编码系统、系统版本、编码列表、取值来源（门诊诊断 / 出院诊断 / 检验 / 用药等）与诊断顺序约束（如"仅主要诊断"或"出院记录前三位诊断"）——即 §2.7.4 示例要求的四要素。算法 MUST 携带版本号与评估时间窗。

算法组合规则 MUST 限于闭合语法（`AND` / `OR` / `NOT` + 编码集成员判定 + 时间窗约束）。连接器 MUST NOT 对算法定义做通用表达式求值。

#### Scenario: 算法定义完整下发并被接受
- **WHEN** 控制面下发一个含编码系统、版本、编码列表、取值来源与诊断顺序的识别算法
- **THEN** 连接器 MUST 接受该算法并可在本地对其求值

#### Scenario: 编码集要素缺失被拒
- **WHEN** 一个识别算法的编码集缺少编码系统版本或取值来源
- **THEN** 连接器 MUST 拒绝执行该验证任务，并说明缺失要素

#### Scenario: 超出闭合语法的算法被拒
- **WHEN** 算法定义中含闭合语法之外的表达式（如内联脚本、函数调用）
- **THEN** 连接器 MUST 拒绝执行，MUST NOT 求值该表达式

### Requirement: 金标准标注本地持有且永不出域

金标准标注集 SHALL 只存在于连接器本地（connector-local 平面）。标注 MUST 记录被标注主体的假名键、所针对的变量定义、判定结论、标注来源（登记库 / 专病数据库 / 本研究人工审阅）、依据的诊断标准与标注时间。个体级标注 MUST NOT 以任何形式出域。

系统 MUST NOT 提供病历审阅工作台——金标准由医院侧产生，本能力只消费。

#### Scenario: 标注个体记录不出域
- **WHEN** 一个验证任务在连接器执行完成
- **THEN** 出域载荷 MUST 只含聚合计数，MUST NOT 含任何个体级标注或假名键

#### Scenario: 无金标准标注时任务失败
- **WHEN** 一个验证任务所针对的变量定义在本地无对应金标准标注
- **THEN** 连接器 MUST 以明确原因失败，MUST NOT 用算法自身输出充当金标准

### Requirement: 本地比对产出混淆矩阵

连接器 SHALL 在 TEE 内对识别算法的判定结果与金标准标注逐主体比对，产出 2×2 混淆矩阵（TP / FP / TN / FN）。该矩阵是本能力唯一的跨域载荷，与 L1.5 失衡信号的四格表结构同构，MUST 复用同一套输出闸门规则（见 [[usage-control]]）。

#### Scenario: 比对产出四格计数
- **WHEN** 算法与金标准在本地完成逐主体比对
- **THEN** 连接器 MUST 输出 TP / FP / TN / FN 四个计数，MUST NOT 输出任何主体标识

#### Scenario: 比对在 TEE 内完成
- **WHEN** 比对过程访问本地记录与金标准标注
- **THEN** 该过程 MUST 在 TEE 内执行，且证明等级 MUST 如实标注（当前 `software`，见 D9 / D-RWS-4）

### Requirement: 准确性指标与置信区间

`algorithm-validation` SHALL 由混淆矩阵计算灵敏度（Se = TP/(TP+FN)）、特异度（Sp = TN/(TN+FP)）、阳性预测值（PPV = TP/(TP+FP)）、阴性预测值（NPV = TN/(TN+FN)），每个指标 MUST 附 95% 置信区间。置信区间 MUST 采用 Wilson score interval（小样本与极端比例下稳健），定义以 DOMAIN.md 派生公式区为唯一出处。

#### Scenario: 四指标带 CI 出具
- **WHEN** 混淆矩阵通过输出闸门
- **THEN** 系统 MUST 给出 Se / Sp / PPV / NPV 各自的点估计与 95% CI

#### Scenario: 高特异度不产生越界区间
- **WHEN** 某算法的特异度点估计接近 1
- **THEN** 其 95% CI 上界 MUST NOT 超过 1（Wilson 保证，Wald 会越界）

### Requirement: 按数据源分列报告，禁止跨源合并

验证结果 SHALL 按数据源（`providerId`）分别报告。系统 MUST NOT 对多个数据源的准确性指标做 meta 合并或求平均。理由：同一概念性定义在不同数据库的操作性定义可能不同（§2.1），多源异质性正是验证要回答的问题，不可假定一致（§1.1）。

#### Scenario: 多院验证结果分列
- **WHEN** 一个验证任务在两家医院执行完成
- **THEN** 结果 MUST 按医院分列呈现两组指标，MUST NOT 输出单一的合并准确性

#### Scenario: 验证任务不走 meta 合并路径
- **WHEN** 控制面编排一个 L0 验证任务
- **THEN** 编排器 MUST 跳过随机效应 meta 合并（见 [[federated-meta-analysis]]）

### Requirement: 验证结果存证与版本绑定

验证结果 SHALL 上链存证（结果哈希 + 时间戳，链上无数据，D6）。验证结果 MUST 绑定三元组：算法版本 + 数据源 + 金标准标注集版本；三者任一变更时，既有验证结果 MUST 被标记为不适用于新组合。历史验证结果 MUST 保留而非覆盖。

#### Scenario: 验证结果哈希上链
- **WHEN** 一组准确性指标出具
- **THEN** 系统 MUST 将其哈希上链存证，且链上 MUST NOT 含指标数值以外的任何原始信息

#### Scenario: 算法升版后旧验证不再适用
- **WHEN** 某识别算法发布新版本
- **THEN** 该算法旧版本的验证结果 MUST NOT 被当作新版本的准确性依据
