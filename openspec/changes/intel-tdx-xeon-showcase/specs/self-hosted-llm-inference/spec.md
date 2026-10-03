## ADDED Requirements

### Requirement: 结果解读走自托管推理端点
控制面 SHALL 提供把已发布的聚合结果（C3）解读为研究性文字草稿的接口，推理 MUST 由配置指定的自托管 OpenAI 兼容端点完成，自托管端点 MUST 可在无密钥下工作；响应 MUST 标明实际使用的供应商与模型。既有任务设计助手（AGT-01）的供应商配置与行为 MUST NOT 因本能力改变。

#### Scenario: 解读一次联合统计结果
- **WHEN** 研究者在作业结果页对一次已发布的聚合结果请求解读，且端点指向 LLMA 的 OpenVINO Model Server
- **THEN** 返回解读草稿、送给模型的事实清单、供应商与模型名，并带「模型生成的草稿，待研究者确认」标注

#### Scenario: 任务设计助手不受影响
- **WHEN** 只配置了 `DEEPSEEK_API_KEY`
- **THEN** 任务设计助手行为与变更前一致

### Requirement: 端点不可用时显式失败
自托管推理端点未配置、不可达或返回错误时，系统 MUST 返回服务不可用错误，且 MUST NOT 改调任何其他供应商。

#### Scenario: 自托管端点宕机
- **WHEN** LLMA 的推理服务未运行或隧道中断
- **THEN** 接口返回 503，且没有任何出站请求发往外部 AI 供应商

### Requirement: 入参仅限聚合字段
解读接口的结果入参 MUST 按白名单校验，只接受受支持分析类型的聚合字段；出现未知字段或不支持的类型 MUST 被拒绝，且模型 MUST NOT 被调用。

#### Scenario: 拒收非聚合载荷
- **WHEN** 请求体的结果里包含行级字段或白名单之外的字段
- **THEN** 返回 400，推理端点不被调用

### Requirement: 数值由服务端计算并回查
解读所需的派生量（率、方向）MUST 由服务端确定性计算后交给模型；模型输出中出现事实清单与研究问题之外的数字时，系统 MUST 拒绝返回该草稿。

#### Scenario: 模型编造数字
- **WHEN** 模型输出包含事实清单中不存在的数值
- **THEN** 返回 422，草稿不展示

#### Scenario: 方向由服务端给出
- **WHEN** 暴露组发生率低于未暴露组
- **THEN** 事实清单中含「低于未暴露者」的方向陈述，模型据此措辞

### Requirement: 调用点与供应商在册
新增的 LLM 调用点 MUST 在 AGENT.md 登记供应商、模型、环境变量与对应 FLOWS.md 流程；自托管推理端点 MUST 仅对控制面可达，公网与参与方域 MUST NOT 可达。

#### Scenario: 治理校验通过
- **WHEN** 运行 `node scripts/check-meta-docs.mjs`
- **THEN** 无未登记的 LLM 调用点，且登记的 flow id 在 FLOWS.md 中存在

#### Scenario: 公网不可达
- **WHEN** 从公网访问 LLMA 的推理端口
- **THEN** 连接被拒绝或超时

#### Scenario: 参与方域不可达
- **WHEN** 从域 B 的 teeB 访问 LLMA 的推理端口
- **THEN** 连接被拒绝或超时
