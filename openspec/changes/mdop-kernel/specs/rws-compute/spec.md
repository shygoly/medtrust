## ADDED Requirements

### Requirement: L1.5 失衡检测经 MDOP 作业执行
在平台与连接器都开启 MDOP 时，L1.5 失衡检测 SHALL 可以按计划模板 `rws.l15.disproportionality` 作为 MDOP 作业执行。

每家医院的片段依次为：
1. `source.dataset@1`：输出 C0；
2. `rws.disproportionality@1`：wasm，输出 C0 四格表；
3. `declassify.small_cell@1`：读合约 `minCell`，含二次抑制，输出 C3；
4. 投递平台。

平台片段为 `merge.disproportionality@1`：合并各院四格表，计算 PRR/ROR/IC，输出 C3。其余分析类型在本期继续走旧管线。

#### Scenario: 与旧通道结果一致
- **WHEN** 在没有触发小单元格抑制的同一份数据上，分别经旧通道和 MDOP 通道执行同一 L1.5 分析
- **THEN** 两者的四格表与 PRR/ROR/IC MUST 逐字段一致

#### Scenario: 任一院拒签
- **WHEN** 两家医院中有一家拒绝片段要约
- **THEN** 作业 MUST 进入 `REJECTED`，MUST NOT 产生任何分析结果

#### Scenario: 合约 minCell 生效
- **WHEN** 某院合约的 `minCell` 为 10，而该院四格表中有一格计数为 7
- **THEN** 该院投递的 C3 结果中这一格 MUST 被抑制，并按二次抑制规则处理可反推的格
