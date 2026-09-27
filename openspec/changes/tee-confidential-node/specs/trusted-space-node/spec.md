## ADDED Requirements

### Requirement: 可信空间节点的身份与能力通告
可信空间节点 SHALL 作为 MDOP 的一等参与方运行：身份为参与方 URN，密钥由节点自己生成并自持（平台 MUST NOT 生成或接触其私钥），注册时只提交公钥。
- 节点 MUST 在能力通告中声明 `tee{kind, min_tcb}`，`kind` 取值来自 `csv`、`tdx`、`sev-snp`。
- 节点 MUST NOT 声明超出实际证明能力的 `kind`；未通告 TEE 能力的节点在编译期即被排除出 C2 目标。
- 节点的长期身份密钥与接收数据密钥的一次性公钥 MUST 分离。

#### Scenario: 未声明 TEE 能力的节点被排除
- **WHEN** 某节点未在能力通告中给出 `tee` 字段，而计划里有一条 C2 边指向它
- **THEN** 编译 MUST 以 `E_CAPABILITY_MISMATCH` 拒绝，并指出该边

#### Scenario: 注册时提交私钥字段
- **WHEN** 节点注册请求里出现任何私钥字段
- **THEN** 平台 MUST 拒绝该注册

### Requirement: 远程证明与度量
节点 SHALL 在每次计算会话开始时生成远程证明报告，报告中 MUST 包含代码度量、TCB 版本、一次性公钥，并绑定节点身份。
一次性公钥 MUST 绑定进 quote 的 `report_data`（硬件签名覆盖的绑定数据；命名按行业惯例，待人工最终确认）；缺绑定或与公钥派生值不符 MUST 视为 `E_ATTESTATION_FAILED`，MUST NOT 产生半份证明。
- 度量白名单 MUST 来自**部署配置**（平台侧 `MDOP_ATTESTATION_MEASUREMENTS` 是上限，节点侧
  `TEE_NODE_MEASUREMENTS` 是本节点允许集的本地副本，二者都是注册中心白名单的**人工同步副本**）；
  合约 MAY 用 `allowed_measurements` 进一步收窄，交集为空即拒（不退化成「不限」）。
  **签名化签发与吊销（「与算子清单同一套机制」）尚未落地、不在本变更范围**（见 design Non-Goals）：
  换版/吊销目前靠重新部署，文档与对外表述 MUST NOT 声称已具备该机制。
- 合约给出 `min_tcb`；TCB 版本低于下限 MUST 被拒。
- 证明 MUST 有短有效期（缺省 10 分钟）并**每次会话重新证明**；MUST NOT 以一次证明长期复用代替持续保证。

#### Scenario: 代码度量不在白名单
- **WHEN** 节点提交的证明中的度量既不在注册中心白名单，也不在合约 `allowed_measurements` 中
- **THEN** 密钥 MUST NOT 被释放，节点 MUST 收到 `E_MEASUREMENT_NOT_ALLOWED` 并记录审计

#### Scenario: TCB 版本过旧
- **WHEN** 证明报告的 TCB 版本低于合约 `min_tcb`
- **THEN** 密钥 MUST NOT 被释放，节点 MUST 收到 `E_TCB_TOO_OLD`

#### Scenario: 复用旧证明
- **WHEN** 节点在证明有效期之外继续使用同一份证明请求密钥
- **THEN** 请求 MUST 被拒绝，节点 MUST 重新证明

#### Scenario: 一次性公钥未进 report_data
- **WHEN** 提供者返回的一次性公钥形状合法，但该公钥未进入 quote 的 `report_data`
- **THEN** 映射与判定 MUST 拒绝（`E_ATTESTATION_FAILED`，不得产生半份证明），KMS MUST NOT 释放密钥

#### Scenario: report_data 与公钥派生值不符
- **WHEN** quote 的 `report_data` 存在，但与一次性公钥的派生值不符
- **THEN** 映射与判定 MUST 拒绝（`E_ATTESTATION_FAILED`，不得产生半份证明），KMS MUST NOT 释放密钥

#### Scenario: 节点回执就是协议回执（可被平台校链与锚定）
- **WHEN** 节点出具解封 / 执行 / 出口 / 销毁回执
- **THEN** 回执 MUST 是协议 `AuditReceipt` 形状（含 `stage` / `op_digest` / `prev_receipt_hash` / 签名；
  解封与执行两类 MUST 带本次证明的 `attestation`），并可被平台的回执链服务逐条解析、校链与锚定链头——
  MUST NOT 只在本地自洽而对外不合法

#### Scenario: 每次会话上报见证
- **WHEN** 节点完成一次 C2 计算会话（含 KMS 释放与节点内执行）
- **THEN** 节点 MUST 把本次证明报告与 KMS 释放凭据作为会话见证上报平台（`AttestationReport`），
  供持有方独立核验；上报内容 MUST 与本次会话实际使用的证明、`key_id`、作业与凭证一致，
  MUST NOT 用历史会话的凭据代替

### Requirement: 证明绑定的密钥释放
数据密钥 SHALL 只能在证明通过后释放，且 MUST 用证明报告中的一次性公钥加密返回。
- KMS 释放前 MUST 逐项校验：证明链到厂商根有效、度量在允许清单、TCB 满足下限、证明未过期、一次性公钥已绑定进 `report_data`、执行凭证签名完整且在有效期、合约未终止、`key_id` 属于本作业片段。
- 密钥 MUST 只存在于该实例内存中；实例退出即失效。
- 平台 MUST NOT 持有数据密钥，也 MUST NOT 存在绕过 KMS 取密钥的路径。
- 任一校验失败 MUST 拒绝并留痕，MUST NOT 回退到明文、旧密钥或跳过校验。

#### Scenario: 一次性公钥已绑定进 report_data
- **WHEN** 一次性公钥的派生值与 quote `report_data` 中的绑定值一致，且其他释放判据均成立
- **THEN** KMS MAY 释放密钥，且 MUST 用该一次性公钥加密返回

#### Scenario: 凭证与请求不匹配
- **WHEN** 节点用作业 A 的凭证去请求作业 B 信封的 `key_id`
- **THEN** 释放 MUST 被拒绝并记录 `E_KEY_RELEASE_DENIED`

#### Scenario: 释放来自非指定的 KMS
- **WHEN** 信封的 `wrapped_key.kms` 指定由**持有方自建的** KMS 保管密钥，而返回的释放凭据由另一个 KMS 签发
- **THEN** 释放 MUST 被拒绝（`E_KEY_RELEASE_DENIED`）——签名只证明「是配置内的某个 KMS」，
  **不证明「就是我指定的那个保管方」**，归属必须逐份核对（D-TEE-1）

#### Scenario: 平台索取数据密钥
- **WHEN** 平台侧任何调用尝试获取数据密钥
- **THEN** 系统 MUST 不存在这样的接口或路径（以用例断言该设计约束）

### Requirement: 节点内执行与发布审查
节点的算子 SHALL 来自注册中心清单（与院内同一套 `wasm`/`system` 语义），未加白或已吊销的算子 MUST 被拒绝执行。
- 发布审查（小单元格抑制 + 二次抑制）与**查询预算** MUST 在节点内执行，并由被测代码强制，
  MUST NOT 依赖运营方自觉（这几项有用例）。
- **ε-差分隐私加噪尚未实现、不在本变更范围**：节点只**如实记录** `dp` 声明（缺省 `{mode:"none"}`），
  **不施加噪声**；`{mode:"epsilon"}` 是**声明**，不等于已加噪。落地前任何文档、界面与对外表述
  MUST NOT 把 `mode=epsilon` 读作「已具备 ε-DP 保证」（TRUST P-CTL-3 为待接入控制点，见 design Non-Goals）。
- 离开节点的制品 MUST 只有 C3；节点内解封后的数据 MUST NOT 以任何形式回流到原持有方以外的节点。
- 节点 MUST 按阶段上报 `StageStatus`（成功带摘要与等级；失败带错误码），MUST NOT 只在作业终态才汇报——
  平台按阶段状态推进下游并按错误码决定重试，缺这条上报会让多阶段作业停在第一个节点阶段。
- 平台 MUST 核对**上报方就是该阶段的落点节点**（身份取自消息层已认证的上下文，MUST NOT 采信消息自述）。
  阶段状态直接驱动状态机：`SUCCEEDED` 会解锁下游下发、`FAILED` 会触发重试或把作业判失败——
  不核对就等于允许任何已认证参与方替别家上报。

#### Scenario: 出口试图投出非 C3
- **WHEN** 节点内的阶段产出 C0 或 C1 并被尝试发往其他节点
- **THEN** 出口守卫 MUST 拒绝该投递并写入签名回执

#### Scenario: 发布审查未通过
- **WHEN** 统计结果中存在低于合约阈值的小单元格
- **THEN** 结果 MUST 被抑制（含二次抑制），MUST NOT 以任何形式出域

#### Scenario: 阶段状态被替报
- **WHEN** 已认证参与方 B 上报「落在 A 上」的阶段状态（无论成功或失败）
- **THEN** 平台 MUST 拒收（400），阶段与作业状态 MUST NOT 发生任何变化

#### Scenario: 节点内中间制品不出域
- **WHEN** 某阶段的产物还有**同节点**的下游阶段（如跨院配对结果要接着做降密）
- **THEN** 该产物 MUST 留在节点本地制品库，只登记句柄、MUST NOT 投递载荷，下游阶段按同一句柄在本节点取用
- **AND** 只有本节点为该作业的**终点产出**（无同节点下游）才可经发布审查出口为 C3

#### Scenario: 未经节点内审查的产物不得出口
- **WHEN** 某阶段产出 C3，但节点内没有该阶段的发布审查记录
- **THEN** 出口 MUST 被拒绝（`E_RELEASE_CHECK_FAILED`），MUST NOT 存在「先出口、审查后补」的路径

#### Scenario: 一次阶段吃多份封存输入
- **WHEN** 一个阶段（如跨院主体配对）需要多家持有方各自的封存输入
- **THEN** 节点 MUST 在**一次会话**内解封全部输入（一次证明、逐份密钥释放），并为每一份释放上报会话见证

### Requirement: 作业之前的证明登记（部署侧校验方背书）
编译期放置 C2 之前，目标节点 MUST 有一份**未过期**的证明登记；登记 SHALL 可由**部署白名单内的校验方**
（KMS / 证明服务）在**作业之前**推送获得——因为会话见证依赖一次作业绑定的密钥释放，作业尚未编译时并不存在。
- 推送 MUST 由校验方对 `{verifier, endorsement}` 整体签名；平台 MUST 用**部署配置**里的校验方公钥验签
  （MUST NOT 取自推送体），并仍按白名单、链型、度量清单与有效期判定。
- 平台 MUST NOT 因此获得验 quote 的能力或职责：它记录的是「配置白名单内的校验方已验过」。
- **软件实现 MUST NOT 作为 C2 目标**：背书只接受硬件链型，出现 `software` 一律拒。
- 节点侧 SHALL 有对应的探针：真跑一次证明后交给校验方，并**自己验**校验方回传的背书，
  核对背书绑定的节点与 `quote_digest` 就是本次这份证明。

#### Scenario: 推送后编译期即可用
- **WHEN** 白名单校验方推送一份签名有效、未过期的节点背书
- **THEN** 登记 MUST 落库，且该节点在编译期 MUST 被判为可作 C2 目标（无需先跑过一次作业）

#### Scenario: 伪造或过期的背书
- **WHEN** 背书由部署配置之外的密钥签名、被改过任一字段、或已过期
- **THEN** 平台 MUST 拒绝登记（`E_ATTESTATION_FAILED`），MUST NOT 因为推送体自述而放行

#### Scenario: 校验方说「已验过」但背书不是给本次证明的
- **WHEN** 节点探针收到的背书签名有效，但绑定的节点不是本节点、或 `quote_digest` 与本次证明不符
- **THEN** 节点 MUST 拒绝该背书并留痕，MUST NOT 把「它说验过了」当作自己的证明

### Requirement: 查询预算与查询审计
节点 SHALL 维护查询预算账本，以「数据集 × 快照版本」为单位记录消耗，并 MUST 以持有方本地账本为准。
- 预算上限在合约中约定；超限的查询 MUST 被拒绝并把拒绝原因回执到作业。
- 节点 MUST 检测差分查询（相似条件的多次查询）与同一申请方的累计输出，并按合约处置。
- 亚组与切点的重算 MUST 计入预算，不得绕过。

#### Scenario: 超预算查询
- **WHEN** 申请方在同一数据集与快照上的累计查询超过合约约定上限
- **THEN** 该查询 MUST 被拒绝，MUST NOT 返回结果

#### Scenario: 差分查询
- **WHEN** 检测到对同一群体的多次相似条件查询
- **THEN** 节点 MUST 记录并上报告警，并按合约决定拒绝后续查询

### Requirement: 节点侧的销毁与回执
节点 SHALL 在作业终态收到 `PurgeOrder` 后销毁节点内制品与临时数据，并返回签名回执。
- 销毁 MUST 覆盖内存与临时盘；重复指令 MUST 返回同一回执（幂等）。
- 节点 SHALL 为解封、执行、出口、销毁各事件出具签名回执并成链，链头供平台锚定。
- 平台 MUST 收齐含该节点在内的全部回执后才可将作业置为 `PURGED`。

#### Scenario: 缺节点回执
- **WHEN** 某可信空间节点未返回销毁回执
- **THEN** 作业 MUST NOT 进入 `PURGED`，平台 MUST 按原幂等键重发

#### Scenario: 销毁后读取
- **WHEN** 销毁回执已出具后，按先前句柄读取节点内制品
- **THEN** 读取 MUST 失败
