## ADDED Requirements

### Requirement: SCRI 作业模板
平台 SHALL 提供 `vaccine-scri` 模板：接种登记方与就诊事件方各生成 `source.dataset → seal.envelope` 两个阶段，可信空间节点生成 `rws.vaccine-scri → declassify.small_cell` 两个阶段；节点阶段按角色（`registry` / `events`）绑定输入。模板 MUST 拒绝：风险期与对照期重叠、两方为同一持有方、缺疫苗或事件编码、缺可信空间节点。

#### Scenario: 合法提交
- **WHEN** 研究方以两份已副署合约、风险期 [1,7]、对照期 [-42,-22]、CVX 与 ICD-10 编码提交 `POST /mdop/jobs/vaccine-scri`
- **THEN** 作业进入 NEGOTIATING，片段为两方各 2 个阶段、节点 2 个阶段

#### Scenario: 窗口重叠
- **WHEN** 风险期与对照期有交集
- **THEN** 返回 400，不创建作业

### Requirement: 最小投影封装
接种登记方 SHALL 只封装 `{linkKey, ageBand, sex, immunizations[code∈vaccineCodes]}`；就诊事件方 SHALL 只封装 `{linkKey, datedEvents[code∈eventCodes]}`。院内假名、其他编码与其他临床字段 MUST NOT 进入封装。

#### Scenario: 编码白名单外的记录
- **WHEN** 受种者另有非 mRNA 疫苗接种记录
- **THEN** 该记录不出现在封装载荷中

### Requirement: 节点内 SCRI 计数
可信空间节点 SHALL 在 Wasm 模块内按 `dayDiff = 事件日 − 接种日` 对每个（剂次 × 同人事件）计数：落入风险期计 `riskEvents`，落入对照期计 `controlEvents`，并按接种方分层统计 `doses`。宿主 MUST 校验：窗口内事件总数不超过配对数，剂次合计等于输入剂次；违反即失败。

#### Scenario: 与答案键一致
- **WHEN** 以 Synthea 演示数据真跑
- **THEN** 四个分层的 `doses / riskEvents / controlEvents` 与 `data/demo/aefi/answer-key.json` 逐格相等

### Requirement: 分层发布审查
每个分层 SHALL 以风险期与对照期中较小的非零计数参与小单元格判定；低于 minCell 的分层整层抑制，抑制层全部数值字段置零。C3 载荷 MUST NOT 包含跨分层合计。

#### Scenario: 小格抑制
- **WHEN** 某分层风险期事件为 3、minCell 为 5
- **THEN** 该分层 `suppressed=true` 且 `doses/riskEvents/controlEvents` 均为 0

### Requirement: SCRI 结果解读
结果解读接口 SHALL 接受 `vaccine-scri` 聚合（白名单字段），服务端计算相对发生率与 Clopper-Pearson 95% 精确置信区间，事实清单 MUST 在逐层明细之前给出确定性归纳的结论行。模型草稿 MUST 同时通过数字回查与结论一致性回查，否则拒绝展示（422）。

#### Scenario: 草稿把显著分层说成不显著
- **WHEN** 存在「高于对照期」的分层，而草稿不含「高于」或含「均未」类一概否定
- **THEN** 接口返回 422，不展示草稿

#### Scenario: 正确草稿
- **WHEN** 草稿如实写出「40 岁以下男性风险期发生率高于对照期（4.45）」且其余分层无差异
- **THEN** 返回草稿，标注「模型生成的草稿，待研究者确认」并附事实清单

### Requirement: 持有方自行核验会话见证
平台登记可信空间节点上报的会话见证后 SHALL 将同一份见证转发给作业各合约的**数据持有方**（合约提供方）及其他接收方（平台与上报节点除外）；持有方连接器自行验签并上报 `WITNESS_VERIFIED` / `WITNESS_REJECTED`。作业视图中「应上报见证的节点」MUST 只包含凭证里冻结了执行环境期望的可信空间节点。

#### Scenario: 两方核验
- **WHEN** teeA 上报会话见证
- **THEN** 疾控与医院连接器各自写出 `WITNESS_VERIFIED`，作业页两条见证均显示「本院核验通过」

### Requirement: 节点销毁回执可被平台验签
可信空间节点的销毁回执 SHALL 以协议规范签名（JCS → SM3 → 国标 SM2，kid = 公钥指纹）签发，平台以 `verifyCanonicalObject` 验签通过后作业进入 `PURGED`。

#### Scenario: 销毁指令
- **WHEN** 平台对已成功作业发出 `PurgeOrder`
- **THEN** 节点销毁制品并上报回执，作业状态变为 PURGED
