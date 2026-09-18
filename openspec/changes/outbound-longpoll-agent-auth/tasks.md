## 1. 治理先行

- [ ] 1.1 DECISIONS.md 新增 D-CN-4：院内唯一出站组件是连接器，Python agent 为院内计算后端；任务下发用长轮询；下发任务带平台签名
- [ ] 1.2 TRUST.md 新增 CTL-21：连接器信道强制证书认证 + 下发任务验签 + 院内计算后端只受本院连接器调用；注明静态令牌缺省值问题随本变更关闭
- [ ] 1.3 FLOWS.md：联邦训练的跨域边改为「控制面 → 连接器（长轮询）」加院内的「连接器 → agent」；任务下发步骤注明长轮询与签名
- [ ] 1.4 ARCHITECTURE.md §6.4 更新（agent 不再有入站）；DEPLOY.md 登记新环境变量（`CONNECTOR_TOKEN_AUTH_ALLOWED`、`CONNECTOR_LONG_POLL_WAIT_MS`、`AGENT_SHARED_TOKEN`、`AGENT_WS_ENABLED`），删除 API 侧的 `AGENT_GRPC_ROUTING`，端口表注明 agent 端口只在院内
- [ ] 1.5 `node scripts/check-meta-docs.mjs` 为 0 error

## 2. 前置：控制面库持久化

- [ ] 2.1 在 `deploy/ali29/` 的覆盖文件里给 api 服务挂载 `/repo/apps/api/data` 卷；首次挂载前用 `docker cp` 把运行中的 `control-plane.db` 拷进卷里
- [ ] 2.2 验证：重建 API 后平台 CA 公钥不变，已有的合约、任务、连接器注册都还在

## 3. 长轮询

- [ ] 3.1 API：`ConnectorTaskNotifier`，按参与方登记等待者，先登记再查待办，超时自动清理
- [ ] 3.2 API：`GET /api/v1/connector/tasks/pending?waitMs=`（上限 25 秒），一次返回 RWS、FL 预测、训练轮次三类待办，每次请求都刷新 `lastSeen`；旧接口标为废弃
- [ ] 3.3 API：在 RWS 创建、重派、修订，FL 预测派发，训练轮次入队这几处调用 `notify`
- [ ] 3.4 连接器：长轮询主循环取代 `setInterval`；HTTP 超时为 `waitMs` 加 10 秒；出错时退避并加抖动；领到的任务交给有并发上限的执行队列；心跳改为每 60 秒一次
- [ ] 3.5 单测：有任务立即返回；超时返回空；挂起期间来了新任务立即返回；漏唤醒竞态；执行长任务期间仍显示在线

## 4. 任务签名与信道鉴权

- [ ] 4.1 API：对下发任务签名，签名内容按 design D4
- [ ] 4.2 连接器：验签，并检查目标参与方、时效、`taskId` 去重；失败时记 `task-signature-invalid` 审计并上报失败
- [ ] 4.3 API：守卫缺省改为强制；删除缺省令牌；令牌方式只在 `CONNECTOR_TOKEN_AUTH_ALLOWED=true` 且显式配置令牌时可用；测试和 e2e 环境显式打开这个开关
- [ ] 4.4 上报类接口的签名内容覆盖请求体的 SM3
- [ ] 4.5 单测：不带签名被拒；令牌降级被拒；验签失败、目标不符、过期、重复的任务被拒；请求体被改后验签失败

## 5. 联邦训练轮次经连接器中转

- [ ] 5.1 编排器：轮次任务入队、`notify`、等待结果，沿用每轮超时与补偿；新增 `POST /api/v1/connector/fl-rounds/:id/complete`（请求体上限 10MB，校验 SM3 和连接器签名）
- [ ] 5.2 连接器：领到轮次任务后依次验签、做 PEP 校验、带共享凭证在院内调用本院 agent 的 `RunLocalRound`、回传结果
- [ ] 5.3 每轮指标随结果回传，经 `/ws/secretflow` 推给前端；删除 `AgentLogBridge`、API 端对 agent 的远程调用和 `AGENT_GRPC_ROUTING`
- [ ] 5.4 e2e：两院多轮训练经连接器中转能收敛；一家医院超时被踢出本轮后，下一轮能恢复参与

## 6. agent 院内鉴权

- [ ] 6.1 gRPC 服务端拦截器：校验元数据 `x-agent-token` 等于 `AGENT_SHARED_TOKEN`，缺失或不符返回 `UNAUTHENTICATED`
- [ ] 6.2 日志 WS 默认关闭（`AGENT_WS_ENABLED`）
- [ ] 6.3 连接器调用 agent（训练和 `RunLocalCausal`）时携带凭证
- [ ] 6.4 单测：无凭证、错误凭证被拒；正确凭证可以调用

## 7. 上线（演示结束后，按 design D8 分阶段）

- [ ] 7.1 阶段 1：完成第 2 组，控制面库持久化
- [ ] 7.2 阶段 2：发布新版 API（守卫仍为非强制），确认旧连接器照常工作
- [ ] 7.3 阶段 3：平台 CA 为两院连接器签发证书，配置 `CONNECTOR_CERT_FINGERPRINT`、`CONNECTOR_SM2_PRIVATE_KEY`、`CONNECTOR_PLATFORM_CA_PUBKEY`、`AGENT_SHARED_TOKEN`；发布连接器和 agent，重建时必须带 `compose.hardening.yaml`
- [ ] 7.4 阶段 4：API 切换为强制守卫，删除 agent 路由配置；验证 RWS 长轮询、联邦训练中转、L2 任务全链路
- [ ] 7.5 L3：等 Cox 小样本返回固定值的问题修复后，再给连接器配置本院 agent 地址，打开 L3
