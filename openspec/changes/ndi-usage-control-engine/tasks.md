# Tasks

- [ ] 取 TC609-6-2025-15 正式文本，逐条对齐术语（允许/有条件允许/拒绝/默认拒绝、义务事项、效果核验）
- [ ] 编写 `design.md`：策略 JSON schema（grant/constraints/obligations/version）、与 `outputPolicy` 的映射、版本演进规则
- [x] 策略类型落 `apps/connector/src/domain/usage-control/engine.ts`（附加面，不污染内核），含 schema 校验正反例
- [x] 解析器：语法 + 语义 + **冲突检测**（allow/deny 同三元组）；签名与存储待接入
- [x] 决策引擎四态；未匹配 → `DEFAULT_DENY`；四态各有用例
- [x] 义务执行器（有序、失败即中断）：`delete-after-use` / `notify-provider` 由调用方注册；`watermark` 留接口
- [ ] 效果核验：删除后不可读、产物哈希与策略绑定；失败中止并审计
- [ ] 存证上报：策略解析结果 + 每次决策 + 义务结果入审计链，摘要随状态上报通道推送
- [x] 旧合约 → 策略默认翻译（`legacy.ts`）：有效合约 ALLOW、失效合约 DENY，**不落 DEFAULT_DENY**
- [x] PEP 接线：`USAGE_CONTROL_ENGINE=legacy|v1|shadow`，缺省 legacy；shadow 只记分歧
- [x] 回归：legacy/v1/shadow/未知取值 + 等价性矩阵（5 种合约状态）
- [ ] 更新 `docs/NDI-TR-2025-连接器与平台标准差距.md` §1 C4/C5/C10/C17 判定与证据

## 离线可用性（必过）

- [ ] `USAGE_CONTROL_ENGINE=legacy` 为缺省，PEP 行为与改造前逐条一致（回归）
- [ ] 旧合约（无策略）默认翻译为改造前语义，**不得**返回 `DEFAULT_DENY`（用例）
- [ ] shadow 模式：只记录引擎判定与 legacy 分歧，不改变结论；分歧报表可查
- [ ] 单合约回退 legacy 不需重启（用例）
