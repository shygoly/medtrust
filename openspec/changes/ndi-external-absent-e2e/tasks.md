# Tasks

## 骨架

- [x] 新增 `scripts/check-ndi-external-absent.mjs`（六条契约机检）并挂进 `pnpm test` 链
- [ ] A 形态编排：`NODE_ENV=production` + `SILKROAD_NODE_ENDPOINT=''`，起 api + connector（本地形态）
- [ ] B 形态编排：`SILKROAD_NODE_ENDPOINT=http://127.0.0.1:1`（必然超时），其余同 A
- [x] 六条契约断言（C1–C6）各有一条负例自检（`check-ndi-external-absent.test.mjs`，7 条）

## 业务链用例

- [ ] 登录 → 目录发布（含 `service` 产品）→ 分类分级校验通过
- [ ] 合约申请 → 批准 → 备案回执（本地链）
- [ ] RWS L1.5 与 L3 任务：领任务 → 执行 → C3 回传 → 结算记录
- [ ] MDOP 作业：提交 → 要约 → 复核 → 凭证 → 执行 → 回执
- [ ] 存证写入 + 按哈希查验（自建链形态）
- [ ] 审计链路完整性校验
- [x] `pushCatalog` 缺 `NDI_ORG_CODE` fail-closed（用例）；推送限定 regional

## 六条契约断言

- [x] C1 迁移只加列（文本判据：ADD COLUMN only，拒 DROP/ALTER/RENAME）
- [x] C2 onModuleInit 未配置时只 warn、禁止 throw
- [x] C3 未配置装配 NoopRegionStateReporter，禁止 fail-closed client
- [x] C4 上报 AbortController 超时 + 定时器 unref
- [x] C5 发布校验仅 isNew/转 regional/声明 spec 时生效（grandfather）
- [x] C6 引擎缺省 legacy、目录服务缺省 off、推送只取 regional、心跳失败降级 warn

## 收尾

- [x] 五个变更 PR 模板加一项：附 `test:e2e:no-external` 运行结果（本仓无 `.github/` PR 模板：等同落在差距文档 §6「送检前置条件」勾选项，评审时逐项核对）
- [x] `docs/NDI-TR-2025-连接器与平台标准差距.md` §6 增「总闸已跑」勾选项（已存在：`pnpm test:e2e:no-external`）
- [ ] 剩余：真实起服务的 `test:e2e:no-external`（当前机检覆盖静态契约，运行态由各变更单测覆盖）
      **阻塞**：需要起 api + connector 的本地编排脚本（connector 需独立库与入网凭证）；机检已挂 `pnpm test`，不因缺运行态脚本而回退基线
