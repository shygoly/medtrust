# 状态：**已作废**（历史草案，不作为变更实施）

> 记于 2026-10-14。本目录不是合规的 OpenSpec 变更（只有 `SPEC.md` / `IMPLEMENTATION.md`）。

## 为什么作废

草案是围绕 **`medtrust-lite` mock demo 栈**设计的「真实演示流程」，而该栈**已下线**
（[ARCHITECTURE.md](../../../ARCHITECTURE.md) §6）。它描述的是「一个集中式 demo 的演示剧本 + 合规表演」，
与现在的事实不符：本仓已是联邦（数据不出域、只出聚合结果），合规要求由元语承载而非演示剧本。

## 由什么取代

- 合规资格：[REGULATORY.md](../../../REGULATORY.md)（REG-x）；研究效度：[EVIDENCE.md](../../../EVIDENCE.md)（EVD-x）；
  数据可信/出域：[TRUST.md](../../../TRUST.md)（CTL-x）。
- 真实演示：各分析场景的 spec-first 变更（如 `mdop-fl-migration`、`vaccine-effectiveness-tnd`、
  归档的 `2026-10-14-rws-analytics-ladder` 等）与连接器 `demo:e2e`。

## 处理方式

保留作历史记录（不删）；**不要**据此实施。
