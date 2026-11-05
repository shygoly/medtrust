# Tasks

- [ ] 取 NDI-TR-2025-04 正式文本，确认标识生成规则与校验位算法（未取到前本变更停在 design 阶段）
- [ ] 新增 `packages/mdop/src/identifier/`：`toNdi` / `fromNdi` / `assertNdiId`，领域中立，含正反例用例
- [ ] `NDI_ORG_CODE` / `NDI_ID_SCHEME_VERSION` 登记 DEPLOY.md 与样例；未配置时对外端点 fail-closed
- [ ] `packages/database`：数据产品/参与方/连接器三张表加 `ndi_id`（可空、唯一、索引）
- [ ] 迁移脚本：按 04 规则生成存量 `ndi_id`；提供回滚脚本
- [ ] 目录推送（`runtime/silk-road`）改用 NDI 标识；保留内部 URN 仅用于回溯
- [ ] 连接器注册载荷携带 NDI 标识（与 `ndi-platform-state-report` 联合验收）
- [ ] 审计/存证元数据双写（内部 URN + NDI 标识）并各加一条断言用例
- [ ] 更新 `docs/NDI-TR-2025-连接器与平台标准差距.md` §1 C16 判定与证据
- [ ] 结论写入 `DECISIONS.md`（新决策：内部 URN 与国标标识的映射边界）

## 离线可用性（必过）

- [ ] `ndi_id` 列为 nullable + 唯一；迁移只加列，回填单独脚本
- [ ] 断言测试：内部读路径（目录/合约/任务/UI）不调用 `toNdi`/`fromNdi`
- [ ] `NDI_ORG_CODE` 未配置时：对外推送报错、本地目录与任务全绿
- [ ] 加用例：缺配置启动成功且只 warning
