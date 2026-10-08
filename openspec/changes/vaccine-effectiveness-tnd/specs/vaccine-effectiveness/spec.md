## ADDED Requirements

### Requirement: TND 纳入与免疫状态判定必须在节点内完成
系统 SHALL 在可信空间节点（TDX）内，把疾控的接种记录与医院的检测记录按关联假名逐人连接，
并按「检测日前 ≥14 天完成末剂接种」判定免疫状态：

- **已接种**：检测日前 ≥ 免疫建立期（默认 14 天，模板参数化）完成末剂；
- **部分免疫**：检测日前 1–13 天接种 → MUST **单列输出**且 MUST NOT 计入主分析（VE 估计）；
- **未接种**：检测日前无目标疫苗记录；
- 判定所需的「检测日 − 末剂接种日」MUST 在节点内完成，MUST NOT 由任一参与方单独判定
  （疾控无检测日期、医院无接种日期）；
- 同一次就诊的重复检测 MUST 按 `(linkKey, 检测日期)` 去重后计入，MUST NOT 重复计数。

#### Scenario: 免疫建立期边界
- **WHEN** 某受检者的末剂接种日与检测日相差 13 天
- **THEN** 该次检测 MUST 归入「部分免疫」列，MUST NOT 计入已接种列

#### Scenario: 边界另一侧
- **WHEN** 末剂接种日与检测日相差 14 天
- **THEN** 该次检测 MUST 归入「已接种」列

#### Scenario: 参与方试图单方判定
- **WHEN** 任一参与方（疾控或医院）在本地尝试判定免疫状态或计算 VE
- **THEN** 系统 MUST NOT 提供该通路：节点外的阶段 MUST 只产出最小投影，判定 MUST 只发生在节点内

#### Scenario: 同次就诊重复检测
- **WHEN** 医院侧同一 `(linkKey, 检测日期)` 存在多条检测记录
- **THEN** 收入本分析的检测 MUST 去重为一条（原始条数 MAY 记入审计，但 MUST NOT 进入计数）

### Requirement: 最小投影与编码白名单
封装阶段 SHALL 按投影名与编码白名单只封最小必要字段，白名单外的字段 MUST NOT 出机构：

- 疾控投影 `ve-registry`：`{linkKey, ageBand, sex, immunizations[{vaccineCode, doseNo, date}]}`，
  `vaccineCode` MUST ∈ 模板给定的疫苗码白名单；
- 医院投影 `ve-tests`：`{linkKey, ageBand?, sex?, tests[{pathogenCode, date, result}]}`，
  `pathogenCode` MUST ∈ 病原码白名单，`result` MUST ∈ `{pos, neg}`；
- 院内假名 `subjectKey`、患者身份标识、白名单外的其它疫苗/检测/就诊 MUST NOT 出现在任何投影中；
- 分层键缺失时 MUST 由数据持有方本地补全或在模板中声明该分层不可用，
  MUST NOT 由节点用任何明文信息回填。

#### Scenario: 白名单外的疫苗
- **WHEN** 疾控的接种记录含白名单外的疫苗码
- **THEN** 该记录 MUST NOT 进入封存载荷，且 MUST 在本地审计中记为已过滤

#### Scenario: 医院缺少分层键
- **WHEN** 医院侧检测记录缺少 `ageBand`/`sex` 且模板声明该分层参与分析
- **THEN** 校验 MUST 失败（fail-closed），MUST NOT 以「未知」层静默进入分层表

### Requirement: 分层 2×2 计数算子（纯数字 ABI，零能力）
节点内算子 `rws.ve-tnd@1.0.0` SHALL 只接收宿主写入线性内存的数字列，输出逐分层六个计数，
MUST NOT 接收主体键文本、日期文本或编码文本：

- 输出形状：`k × {vaccPos, vaccNeg, unvaccPos, unvaccNeg, partialPos, partialNeg}`；
- 不变量：每层六格之和 MUST 等于该层纳入的检测数（宿主回填后校验，违反即失败）；
- MUST NOT 输出跨层合计；
- 模块 MUST 只导入 `env.memory`，MUST NOT 导入函数/表/全局量，MUST NOT 调用 WASI；
- 模块 ABI 版本 MUST 与宿主声明一致（宿主显式声明 `ve-tnd@1`），模块自述不作数。

#### Scenario: 不变量被破坏
- **WHEN** 宿主回填后发现某层六格之和 ≠ 该层检测数
- **THEN** 该阶段 MUST 失败（MUST NOT 输出部分结果），作业 MUST NOT 进入发布审查

#### Scenario: 试图向模块传递明文
- **WHEN** 有人在数字列之外尝试把主体键或日期文本传入模块内存
- **THEN** 该做法 MUST 被架构拒绝：模块只读宿主给定的数字区间，且宿主编码函数 MUST NOT 写入文本

### Requirement: 发布审查按最小非零格抑制
发布审查 SHALL 逐层取四个主分析格（`vaccPos/vaccNeg/unvaccPos/unvaccNeg`）中**非零最小值**与 minCell 比较：

- 任一格偏小 → MUST **整层抑制**，该层所有数值字段置零；
- MUST NOT 输出任何跨层合计（合计减未抑制层可反推被抑制层）；
- 结果 MUST 记明抑制层数与 minCell 取值。

#### Scenario: 某层出现小格
- **WHEN** 某层 `unvaccPos = 3` 且 minCell = 5
- **THEN** 整层 MUST 被抑制且数值置零，结果中 MUST 只体现该层被抑制这一事实

#### Scenario: 抑制后仍可反推
- **WHEN** 输出中包含跨层合计且存在被抑制层
- **THEN** 该输出 MUST 被视为违规（合计可反推小细胞）

### Requirement: VE 与区间为确定性计算，不可估层必须显式
系统 SHALL 由服务端确定性计算层内效应量与区间，MUST NOT 交由语言模型产生数值：

- 层内 `OR = (vaccPos × unvaccNeg) / (vaccNeg × unvaccPos)`，`VE = 1 − OR`；
- 区间：Woolf 法 `SE(lnOR) = sqrt(1/a+1/b+1/c+1/d)`，`lnOR ± 1.96·SE` → 取反得 VE 区间；
- 存在零格时 MUST 使用 Haldane-Anscombe 校正（各格 +0.5）并**显式标注「已校正」**；
- 当 `vaccPos = 0` 或 `unvaccPos = 0` 时该层 VE MUST 呈现为**「不可估计」**，
  MUST NOT 呈现为 0、100% 或省略该层；
- ≥3 层可估时 MAY 给出固定效应合并估计，MUST 标注合并方法。

#### Scenario: 零格层
- **WHEN** 某层 `vaccPos = 0`（已接种者无阳性）
- **THEN** 该层 MUST 显示「不可估计」，MUST NOT 显示 VE = 100%

#### Scenario: 语言模型试图改写数值
- **WHEN** 解读草稿中的 VE 或区间与事实清单不一致
- **THEN** 该草稿 MUST 被拒收（数值以确定性计算为准）

### Requirement: 事实清单前置结论与结论一致性回查
系统 SHALL 在事实清单中前置确定性结论行，并对解读草稿做方向一致性回查：

- 结论行 MUST 含：可估层数、方向（保护/无保护）、区间是否含 0、抑制层数、以及「合成数据 + 注入效应量」声明；
- 草稿与事实清单方向矛盾（如有层显示保护而草稿称「均无保护」）→ MUST 422 拒收；
- 草稿 MUST 标注「待研究者确认」，MUST NOT 表述为监管可用结论。

#### Scenario: 方向说反的草稿
- **WHEN** 事实清单含至少一层 VE > 0 且区间不含 0，而草稿称「各层均未见保护」
- **THEN** 系统 MUST 以 422 拒收该草稿

#### Scenario: 合成数据被写成真实结论
- **WHEN** 草稿或对外物料把注入效应量表述为真实疫苗保护效果
- **THEN** 该表述 MUST 被拒（受 `tdx-attestation-pilot/external-claims.md` 红线约束）
