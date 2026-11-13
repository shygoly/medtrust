# Spec Delta

## MODIFIED Requirements

### Requirement: 任务列表状态徽章映射正确且单一
统一任务列表 SHALL 将各通道原始状态映射到闭集浏览徽章 **进行中 / 已完成 / 失败 / 已取消**（或其登记的英文键 `running` / `completed` / `failed` / `cancelled`），且每一行 MUST 只突出一个主状态徽章。已知终态 MUST NOT 被映射为进行中。执行失败 MUST 映射为「失败」，MUST NOT 映射为「已完成」。中止、驳回或拒绝 MUST 映射为「已取消」。列表 MUST NOT 再用「已拦截 / 受阻」作为作业主徽章文案（节点/闸门阻断若需展示，MUST 使用节点态或次要文案，不得挤占该闭集）。

#### Scenario: 失败不是已完成
- **WHEN** 任务或 MDOP 作业的通道原始状态为失败类（如 `FAILED`、`failed`、`partial`）
- **THEN** 列表主徽章 MUST 显示「失败」，MUST NOT 显示「已完成」或「进行中」

#### Scenario: 取消与失败可区分
- **WHEN** 作业为中止或驳回类状态（如 MDOP `ABORTED` / `REJECTED`，或联邦 `REFUSED`）
- **THEN** 列表主徽章 MUST 显示「已取消」，MUST NOT 显示「失败」或「已完成」

#### Scenario: 成功终态为已完成
- **WHEN** 通道原始状态为成功终态（如 MDOP `SUCCEEDED`、RWS/L4 `completed`、SecretFlow `COMPLETED`）
- **THEN** 列表主徽章 MUST 显示「已完成」

#### Scenario: PURGED 不是进行中
- **WHEN** MDOP 作业 `status` 为 `PURGED`
- **THEN** 列表主徽章 MUST NOT 显示「进行中」

#### Scenario: PURGED 带失败线索不是已完成
- **WHEN** MDOP 作业 `status` 为 `PURGED` 且可得线索表明销毁前为失败或中止（例如非空失败/拒绝原因）
- **THEN** 列表主徽章 MUST 分别映射为「失败」或「已取消」，MUST NOT 显示「已完成」

#### Scenario: PURGED 无拒绝原因视为成功销毁
- **WHEN** MDOP 作业 `status` 为 `PURGED` 且无 `rejectReason`（且无显式反证）
- **THEN** 列表主徽章 MUST 显示「已完成」，次要文案 MUST 仍可保留原始 `PURGED`

#### Scenario: 单一主徽章
- **WHEN** 用户查看任务列表某一行
- **THEN** 该行 MUST 有且仅有一个主状态徽章表达归一状态；通道原始状态若展示，MUST 为次要文案而非第二枚对等徽章

#### Scenario: 分面与闭集一致
- **WHEN** 用户按状态筛选统一任务列表
- **THEN** 可选状态分面 MUST 为进行中 / 已完成 / 失败 / 已取消（或与主徽章同一闭集），MUST NOT 再提供仅对应旧 `blocked`/「受阻」的作业主分面

## ADDED Requirements

### Requirement: 详情页头主徽章与列表同一闭集
多通道任务详情页头的归一状态徽章 SHALL 使用与统一任务列表相同的四态闭集与同一套通道映射规则（含 `PURGED` 推断），MUST NOT 列表显示「失败」而详情页头显示「已完成」或「已拦截」。

#### Scenario: 列表与详情一致
- **WHEN** 同一作业在列表主徽章为「失败」且用户打开其详情
- **THEN** 详情页头主徽章 MUST 为「失败」
