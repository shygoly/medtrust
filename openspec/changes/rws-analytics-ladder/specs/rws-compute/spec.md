## ADDED Requirements

### Requirement: 分析分级与充分统计量出域
`rws-compute` SHALL 支持分层的 RWS 分析类型,除 L1 描述统计外新增:L1.5 失衡信号、L2 比较、L3 因果、L4 预测。每一层 MUST 在连接器 TEE 内本地计算,且 MUST 只输出该层的充分统计量(计数 / 列联表 / 效应量+标准误 / 加密梯度),行级原始数据 MUST NOT 出域。

#### Scenario: L1.5 失衡信号仅出列联表
- **WHEN** 一个 L1.5 失衡信号任务在连接器执行
- **THEN** 连接器 MUST 仅输出 drug×event 的 2×2 计数(供中心计算 PRR/ROR/IC),MUST NOT 输出任何个体记录

#### Scenario: L2 比较仅出效应量
- **WHEN** 一个 L2 比较任务在连接器执行
- **THEN** 连接器 MUST 仅输出分层 2×2 计数或局部回归系数 β + 协方差,MUST NOT 输出个体记录

#### Scenario: L3 因果仅出站点效应量
- **WHEN** 一个 L3 因果任务(站内 PSM/IPTW 或局部 Cox)在连接器执行
- **THEN** 连接器 MUST 仅输出站点级效应量(ATE 或 HR)+ 标准误,倾向评分匹配/加权 MUST 在站内完成,MUST NOT 跨站交换个体

#### Scenario: 未授权分析层被拒
- **WHEN** 一个任务请求的分析层级超出数字合约允许范围
- **THEN** 连接器 MUST 拒绝执行(见 [[usage-control]] 分析分级授权)

### Requirement: 两种联邦执行模式
`rws-compute` SHALL 支持两种联邦执行模式:模式 A(本地全量计算 + 中心随机效应 meta 合并,单发);模式 B(迭代联邦拟合,多轮)。模式 B 复用既有多轮联邦学习通道,**扩展了 L1 版本"仅 TEE 单发通道、联邦学习通道不在范围"的原始约束**。任务 MUST 声明其执行模式。

#### Scenario: 模式 A 单发出站点效应量
- **WHEN** 一个模式 A 任务在各参与方连接器执行完成
- **THEN** 每个连接器 MUST 一次性输出站点级效应量,供中心 meta 合并(见 [[federated-meta-analysis]])

#### Scenario: 模式 B 多轮仅交换聚合量
- **WHEN** 一个模式 B 任务进行迭代联邦拟合
- **THEN** 每轮跨连接器交换的 MUST 仅为加密梯度 / 模型增量 / 充分统计,MUST NOT 为个体记录

### Requirement: 高阶统计量输出闸门
连接器输出闸门 SHALL 对高阶分析产物应用额外抑制规则,在小单元格抑制之外:效应量所依据的分层样本量低于阈值时 MUST 抑制该效应量;生存曲线 MUST 分箱,且每区间在险人数低于阈值时 MUST 抑制或合并该区间;联邦模型产物(权重/梯度)MUST 施加差分隐私噪声(声明 ε 预算)以防成员推断。

#### Scenario: 小分层效应量抑制
- **WHEN** 一个 L2/L3 效应量的某分层样本量低于阈值
- **THEN** 输出闸门 MUST 抑制该分层的效应量后再放行

#### Scenario: 生存曲线尾部保护
- **WHEN** 一条 Kaplan-Meier 曲线某区间在险人数低于阈值
- **THEN** 输出闸门 MUST 分箱/合并或抑制该区间,防止末段单点重识别

#### Scenario: 模型产物差分隐私
- **WHEN** 一个 L4 任务输出联邦模型参数或梯度
- **THEN** 输出闸门 MUST 确认已按声明的 ε 预算施加差分隐私噪声,否则 MUST 阻止出域
