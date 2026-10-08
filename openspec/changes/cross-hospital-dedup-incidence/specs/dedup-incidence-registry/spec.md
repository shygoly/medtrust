## ADDED Requirements

### Requirement: 跨院去重口径必须在节点内强制
系统 SHALL 在可信空间节点（TDX）内，按关联假名把多家医院的记录归并为「同一个人」，并按下列口径去重，
口径 MUST 由模板声明并写入作业记录，MUST NOT 由任一参与方在本地自行裁剪后相加：

- **人头**：按 `linkKey` 取**并集**（同一人在多院只计一次）；
- **人时**：同一 `linkKey` 的观察期取**区间并集**，重叠部分 MUST NOT 重复计入；
  相邻观察期（前段 `end` 与后段 `start` 相差 ≤ 1 天）MAY 按模板开关合并；
- **事件**：按 `(linkKey, 事件编码, 事件日期)` 去重，同一事件被多院各记一次 MUST 只计一次；
- **罕见病**：按人去重，首次诊断取**最早日期**；
- 观察期 MUST 裁剪到模板声明的研究窗口内。

#### Scenario: 重叠观察期
- **WHEN** 同一 `linkKey` 在 A 院有观察期 [100, 200]、在 B 院有 [150, 250]
- **THEN** 并集人时 MUST 为 [100, 250] 的天数，MUST NOT 为两段之和

#### Scenario: 相邻观察期（1 天边界空隙）
- **WHEN** 同一 `linkKey` 两段观察期为 [100, 200] 与 [202, 250]（中间空 1 天），且模板开启相邻合并
- **THEN** 并集 MUST 被视为连续一段 [100, 250]（该 1 天计入人日，避免入院/出院日边界产生空隙）；
  关闭该开关时 MUST 保留该空隙（人日按两段之和计）

#### Scenario: 同一事件被两院记录
- **WHEN** 同一 `linkKey` 的同一事件（同编码同日期）在两家医院各有一条记录
- **THEN** `eventsDeduped` MUST 只计一次

#### Scenario: 罕见病重复登记
- **WHEN** 同一 `linkKey` 的同一罕见病在两家医院各有一次诊断（日期不同）
- **THEN** 该人 MUST 只计 1 例，且首次日期 MUST 取两者中较早者

#### Scenario: 参与方试图本地裁剪后相加
- **WHEN** 任一参与方试图用本院裁剪/去重后的口径直接与其它院结果相加作为结论
- **THEN** 该口径 MUST NOT 被系统认可：正式结果 MUST 只来自节点内去重后的 C3 聚合

### Requirement: 最小投影与白名单
封装阶段 SHALL 只封最小必要字段与白名单内编码：

- 各院投影 `dedup-cohort`：`{linkKey, ageBand, sex, observation{start,end},
  events[{code ∈ eventCodes, date}], rareDisease{code ∈ rareCodes, firstDate} | null}`；
- 白名单外的事件/诊断编码、以及研究窗口外的观察期 MUST 在本地裁剪，并 MUST 留本地审计（记明被裁剪条数）；
- 院内假名 `subjectKey`、患者身份标识 MUST NOT 出现在投影中。

#### Scenario: 窗口外观测期
- **WHEN** 某记录的观察期完全落在研究窗口之外
- **THEN** 该记录 MUST NOT 进入载荷，且 MUST 在本地审计中记为已裁剪

#### Scenario: 白名单外诊断
- **WHEN** 记录含白名单外的诊断编码
- **THEN** 该编码 MUST NOT 出现在载荷中

### Requirement: 去重算子为纯数字 ABI 且校验不变量
节点内算子 `rws.dedup-incidence@1.0.0` SHALL 只接收宿主写入线性内存的数字列，输出逐层
`{uniqueSubjects, personDaysUnion, eventsDeduped, rareCases}`，并 MUST 通过下列不变量校验（违反即阶段失败）：

1. `uniqueSubjects ≤ 该层输入行数`；
2. `personDaysUnion ≤ Σ(该层各行观察天数)`；
3. 分层互斥时 `Σ_k uniqueSubjects == 全量去重主体数`；不互斥时 MUST 允许 `>` 并记明口径；
4. `eventsDeduped ≤ 该层非零事件行数`；
5. `rareCases ≤ uniqueSubjects`。

- 模块 MUST NOT 接收主体键文本、日期文本或编码文本；
- 模块 MUST 只导入 `env.memory`，MUST NOT 导入函数/表/全局量，MUST NOT 调用 WASI；
- MUST NOT 输出任何跨层合计。

#### Scenario: 不变量被破坏
- **WHEN** 回填后发现 `rareCases > uniqueSubjects` 或 `personDaysUnion` 超过各行天数之和
- **THEN** 该阶段 MUST 失败，MUST NOT 输出部分结果

### Requirement: 发布审查采用双阈值（常规 + 罕见病）
发布审查 SHALL 按 layer 计算 `count = min(非零的 uniqueSubjects, eventsDeduped, rareCases)` 与 `minCell` 比较，
并对罕见病施加**更严阈值**：

- 层内存在 `0 < rareCases < minCellRare`（默认 10）→ 该层**罕见病列 MUST 单独抑制**（置零并标注），
  其余列按 `minCell` 判定；
- 层内常规三列任一非零值 `< minCell` → **整层抑制**；
- MUST NOT 输出任何跨层合计；
- 结果 MUST 记明抑制层数、被单独抑制的罕见病列、以及两个阈值的取值。

#### Scenario: 罕见病小细胞
- **WHEN** 某层 `rareCases = 4` 且 `minCellRare = 10`
- **THEN** 该层罕见病列 MUST 被抑制并标注，MUST NOT 输出 4

#### Scenario: 为可读性放宽阈值
- **WHEN** 为提高可读性有人把 `minCellRare` 调低以显示小细胞罕见病例数
- **THEN** 该做法 MUST 被拒绝：阈值取值 MUST 记录在结果与作业记录中，变更 MUST 走显式决策

### Requirement: 发病率与去重前后对比必须同时过闸
系统 SHALL 由服务端确定性计算统计量，并 MUST 同时报告「各院直接相加」与「节点内去重后」两个口径：

- 粗发病率 = `eventsDeduped / (personDaysUnion / 365.25) × 100,000`，区间用 Poisson 精确法
  （`eventsDeduped = 0` 时给出单侧上界），MUST 标注方法；
- **去重前后对比** MUST 同时给出人头 / 人时 / 事件的三对数值与**虚增比例**；
- 两个口径 MUST 都通过同一发布审查（MUST NOT 以「对比用」为由放行小细胞）；
- 直接标准化率（可选）的标准人口权重 MUST 为部署参数，MUST NOT 进入节点；
- 结果 MUST 声明「去重正确性依赖各院假名一致」。

#### Scenario: 对比值含小细胞
- **WHEN** 「各院直接相加」口径的某层出现 `< minCell` 的格
- **THEN** 该层在两个口径中 MUST 同时被抑制

#### Scenario: 区间方法未标注
- **WHEN** 结果给出率区间但未标注所用方法（Poisson/Byar 等）
- **THEN** 结果 MUST 被视为不合格

### Requirement: 事实清单前置结论与如实边界
系统 SHALL 在事实清单中前置确定性结论，并强制如实边界：

- 结论行 MUST 含：去重前后对比与虚增比例、粗率与区间、罕见病例数（或被抑制事实）、抑制层数；
- MUST 含三段声明：**「跨院重复比例为注入」**、**「罕见病患病率已放大 N 倍」**、**「合成数据，不代表任何真实人群」**；
- MUST NOT 出现任何真实地区/机构的发病率或罕见病例数表述；
- 解读草稿与事实清单方向矛盾（如把明显虚增说成「无差异」、把注入比例说成真实重叠率）→ MUST 422 拒收。

#### Scenario: 把注入比例当真实重叠率
- **WHEN** 草稿或对外物料把注入的跨院重复比例表述为真实人群的跨院就诊比例
- **THEN** 该表述 MUST 被拒（受 `tdx-attestation-pilot/external-claims.md` 红线约束）

#### Scenario: 抑制层被反推
- **WHEN** 通过对比值、分层差或时间趋势可反推被抑制层的小细胞
- **THEN** 该输出 MUST 被视为违规并阻断发布
