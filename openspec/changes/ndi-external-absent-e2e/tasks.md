# Tasks

## 骨架

- [ ] 新增 `pnpm test:e2e:no-external` script 与一次性数据库初始化/销毁脚本
- [ ] A 形态编排：`NODE_ENV=production` + `SILKROAD_NODE_ENDPOINT=''`，起 api + connector（本地形态）
- [ ] B 形态编排：`SILKROAD_NODE_ENDPOINT=http://127.0.0.1:1`（必然超时），其余同 A
- [ ] 断言工具：互认端点 503 错误码/文案、长轮询耗时上限（基线 + 1s）

## 业务链用例

- [ ] 登录 → 目录发布（含 `service` 产品）→ 分类分级校验通过
- [ ] 合约申请 → 批准 → 备案回执（本地链）
- [ ] RWS L1.5 与 L3 任务：领任务 → 执行 → C3 回传 → 结算记录
- [ ] MDOP 作业：提交 → 要约 → 复核 → 凭证 → 执行 → 回执
- [ ] 存证写入 + 按哈希查验（自建链形态）
- [ ] 审计链路完整性校验
- [ ] `pushCatalog`：A 形态明确失败、B 形态失败但本地目录仍可读写

## 六条契约断言

- [ ] schema 快照对比：迁移只加列（无改类型/删除/重命名）
- [ ] 外部缺失时启动成功且只 `warn`
- [ ] 装配断言：后台上报拿到 `NoopRegionReporter`（不是 fail-closed client）
- [ ] 预算隔离：外部不可达时长轮询耗时不超上限
- [ ] 存量 grandfather：既有 `productType=service` 产品仍可更新
- [ ] `USAGE_CONTROL_ENGINE=legacy` 下 PEP 行为逐条一致

## 收尾

- [ ] 五个变更 PR 模板加一项：附 `test:e2e:no-external` 运行结果
- [ ] `docs/NDI-TR-2025-连接器与平台标准差距.md` §6 增「总闸已跑」勾选项
- [ ] 记录基线耗时，后续若超 2 分钟需拆分套件
