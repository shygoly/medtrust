# P1-8 分类分级标签标准化

## Why
classification 从自由文本改为结构化标签(级别+类别编码+标签版本);发布校验;存量迁移;分级驱动差异化策略。

## What Changes
DataProduct 增加 classificationTag;DTO 校验;seed 迁移。

## Impact
- 受影响的 specs: 按 ARCHITECTURE §7.1 登记。
- 风险: 见整改计划 §5。
