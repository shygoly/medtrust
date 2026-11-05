# Tasks

- [ ] 取 TC609-6-2025-15 正式文本，逐条对齐术语（允许/有条件允许/拒绝/默认拒绝、义务事项、效果核验）
- [ ] 编写 `design.md`：策略 JSON schema（grant/constraints/obligations/version）、与 `outputPolicy` 的映射、版本演进规则
- [ ] 策略类型落 `packages/space-kernel-spi`（或旁挂领域包），含 schema 校验正反例
- [ ] 解析器：完整性（SM2 签名/SM3）、语法、语义、**冲突检测**、canonical 存储
- [ ] 决策引擎四态；未匹配/解析失败 → `DEFAULT_DENY`；补四态各自的正反例
- [ ] 义务执行器（有序）：先做「用后删除」「过程通知」，水印留接口并标注未实现
- [ ] 效果核验：删除后不可读、产物哈希与策略绑定；失败中止并审计
- [ ] 存证上报：策略解析结果 + 每次决策 + 义务结果入审计链，摘要随状态上报通道推送
- [ ] `apps/api/src/runtime/digital-contract`：合约 → 策略编译（旧合约按默认策略翻译）
- [ ] PEP 改造为调用引擎，保留 `USAGE_CONTROL_ENGINE=legacy|v1` 灰度开关
- [ ] 回归：legacy 模式下 PEP 行为与改造前逐条一致
- [ ] 更新 `docs/NDI-TR-2025-连接器与平台标准差距.md` §1 C4/C5/C10/C17 判定与证据

## 离线可用性（必过）

- [ ] `USAGE_CONTROL_ENGINE=legacy` 为缺省，PEP 行为与改造前逐条一致（回归）
- [ ] 旧合约（无策略）默认翻译为改造前语义，**不得**返回 `DEFAULT_DENY`（用例）
- [ ] shadow 模式：只记录引擎判定与 legacy 分歧，不改变结论；分歧报表可查
- [ ] 单合约回退 legacy 不需重启（用例）
