# MDOP v0.2 → v0.3 迁移说明

2026-10-15。协议正文见 `docs/医疗数据跨节点算子编排协议规范（MDOP）v0.3.md`。

## 既有作业不用改

聚合阶段是可选的。没有 `secure_aggregate` 阶段的作业继续按 v0.2 编译、下发和合并，不必改计划、不必改信封版本字段的解析（信封接受 `x.y`）。`MDOP_PROTOCOL_VERSION` 仍是 `"0.2"`，直到有作业声明安全聚合。

声明了 `secure_aggregate` 的作业必须按 v0.3：参与方在编译期闭合，平台只路由密文，节点本地 FedAvg 后交回 C3。任一方超时或解密失败，整个作业 `REJECTED`。

## LoRA FedAvg 前置清单（批次 1B，本变更不做）

切 `fl.lora-fedavg` 之前逐项核对，缺一不可：

1. 训练算子 `rws.lora-train@1.0.0` 已登记，且其输出等级是 C1（安全聚合只接受 C1）。
2. 计划模板 `buildLoraFedAvgPlan` 把各院训练阶段接到 `merge.fedavg-secure@1.0.0`，`timeout_s` 为正整数，算法是 `fedavg`。
3. 每个参与方连接器已注册 `secure_aggregate` 处理器，并持有本节点 SM2 私钥与其余参与方公钥。
4. 台账 `fl.lora-fedavg` 的切换、观察窗和旧通道删除仍按 `mdop-fl-migration` 执行，不在本协议变更里改台账。
5. L4 联邦预测仍是平台合并明文效应，不借这条聚合通道。
