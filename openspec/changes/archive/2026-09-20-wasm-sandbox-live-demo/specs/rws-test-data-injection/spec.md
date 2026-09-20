## ADDED Requirements

### Requirement: disproportionality 演示队列供给
连接器演示数据集 SHALL 含一个 disproportionality 可执行的队列——记录带 `medications` 与事件词条（`adverseEvents`）——并供给到对应数据产品的 `localDataPath`（随连接器镜像烘焙或挂卷，对齐现有非 git 演示数据的供给方式），使 disproportionality 任务能取数执行。

#### Scenario: 连接器含 disproportionality 队列
- **WHEN** 连接器镜像/挂卷按产品 `localDataPath` 供给了 disproportionality 队列
- **THEN** disproportionality 任务取数成功，不再失败于「本地数据路径不存在」

#### Scenario: 队列可产出非平凡失衡信号（阶段 2）
- **WHEN** 供给的是 AMR「以耐药为事件」数据集（非胰岛素稀疏 AE 队列）
- **THEN** disproportionality 计算能产出非平凡 a/b/c/d，经小格抑制后回传
