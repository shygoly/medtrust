## Context

- **任务下发现状**：连接器 `connector-worker.service.ts` 用 `setInterval`（`CONNECTOR_POLL_INTERVAL_MS`，缺省 5000）每轮同时拉取 `GET /connector/rws/pending` 和 `GET /connector/fl-prediction/pending`，另发心跳。API 端 `RwsOrchestratorService.pullPending(providerId)` 在拉取时把派发记录从 pending 改为 running，并写入冻结时间。
- **联邦训练现状**：`SecretFlowOrchestratorService.orchestrateMulti` 按轮、按医院调用 `AgentDispatchClient.runLocalRound`（gRPC `createInsecure()`，按 `AGENT_GRPC_ROUTING` 路由到各院 agent），`AgentLogBridge` 连进 agent 的 WS（5023）读取日志。agent 用 `add_insecure_port` 监听，不校验调用方。
- **L3 因果**：NestJS 连接器在院内调用本院 agent 的 `RunLocalCausal`（`AGENT_GRPC_URL`）。ali29 上的连接器没配这个变量，L3 在线上直接失败。
- **连接器鉴权**：`ConnectorTokenGuard` 带 SM2 证书头时验签（`connectorAuth.verifyRequest`）；不带时，若 `CONNECTOR_CERT_AUTH_REQUIRED=true` 就拒绝，否则比对 `CONNECTOR_PULL_TOKEN`，代码里的缺省值是 `dev-connector-token`。连接器侧已有 `CONNECTOR_CERT_FINGERPRINT` 和 `CONNECTOR_SM2_PRIVATE_KEY` 两个读取点。ali29 两端都没有配置。
- **信任锚**：平台 CA（`ca.service.ts`）根密钥存在控制面 SQLite 的 `cp_ca_keypair` 表。该库在 API 容器内（`CONTROL_PLANE_DB_URL` 缺省 `./data/control-plane.db`），没有挂载卷。
- **已加固的网络**：ali29 每院一个 internal 网络（`deploy/ali29/compose.hardening.yaml`），院内容器不发布端口，API 通过网络别名接入两院网络。

## Goals / Non-Goals

**Goals:**
- 平台与医院之间的所有流量都由院内连接器发起，包括联邦训练轮次；agent 不对平台暴露。
- 任务下发几乎实时，空闲时不空转。
- 双向可信：平台验证连接器的证书签名，连接器验证平台对任务的签名。
- CA 根密钥在 API 重建后保持不变。

**Non-Goals:**
- 不做国密 TLS（TLCP）。传输层暂用标准 TLS，国密体现在应用层的 SM2 签名和 SM3 摘要上。TLCP 另立变更，需要 Tongsuo。
- 不做 API 多实例。等待者登记在进程内存，适用于单实例。
- 连接器与 agent 之间暂不做 mTLS。

## Decisions

### D1 院内唯一出站组件 = 连接器，agent 退为院内计算后端
平台只与连接器通信。agent 只接受本院连接器调用，联邦训练轮次和 L3 因果都经过连接器。

好处：医院防火墙只需一条出站规则；每院只有一个证书身份；只有一处本地审计；联邦训练轮次在院内也能先过连接器的 PEP（D3），这是新增的执行点。
- **备选：agent 自己主动向平台建立 gRPC 双向流**。每院会有两个出站组件、两个身份、两处审计，API 还要新开一个 gRPC 端口。不采用。
- **备选：保留入站，加 mTLS**。仍要医院开入站端口，违反规格。不采用。

### D2 长轮询协议
- **接口：** `GET /api/v1/connector/tasks/pending?waitMs=25000`，参与方身份取自连接器证书。响应为 `{ rws: [...], flPrediction: [...], flRounds: [...], serverTime }`，每一项都带平台签名（D4）。
- **服务端流程：**
  1. 先在 `ConnectorTaskNotifier` 登记等待者（按参与方）；
  2. 再查一次待办，避免「查完没有、正要登记时恰好来了任务」导致漏唤醒；
  3. 有待办就注销等待者并立即返回。领取语义保持不变，RWS 仍在领取时置为 running、写冻结时间；
  4. 没有待办就等 `notify(participantId)` 或超时。超时返回空列表。
- **唤醒点：** RWS 的创建、重派、修订，FL 预测派发，联邦训练轮次入队，各调用一次 `notify`。
- **时限：**
  - 服务端上限 25 秒，低于 nginx 缺省的 60 秒和 Cloudflare 的 100 秒；
  - 客户端的 HTTP 超时为 `waitMs` 加 10 秒；
  - 收到响应立即重新请求；网络错误时按 1 秒到 30 秒指数退避，并加抖动。
- **在线判定：** 每次长轮询都刷新 `cp_connector_registry.lastSeen`。显式心跳（携带版本与资源信息）降为每 60 秒一次。
- **不阻塞在线状态：** 连接器的长轮询循环只负责领任务，把任务交给执行队列（并发上限可配），所以执行耗时的任务期间仍然在线。
- **兼容：** 旧的 `rws/pending` 和 `fl-prediction/pending` 在迁移期保留，并标为废弃。
- **备选：短轮询缩短间隔**。空转请求更多，仍有延迟。不采用。
- **备选：连接器向平台建常驻 WebSocket**。对 RWS 这种低频任务来说太重，而且要自己处理重连。长轮询是普通 HTTPS，过代理最省事。

### D3 联邦训练轮次经连接器中转
- **编排器侧：** 第 r 轮为每家医院生成轮次任务 `{ taskId, round, specYaml, globalAdapterJson, nodePlan, contract }` 放入队列，调用 `notify`，然后等待这家医院的结果。沿用现有的每轮超时与补偿：超时的医院踢出本轮。
- **连接器侧，领到轮次任务后依次执行：**
  1. 验签（D4）；
  2. 用本地合约视图做 PEP 校验；
  3. 用院内 gRPC 调用本院 agent 的 `RunLocalRound`，带共享凭证（D6）；
  4. 把结果 `POST /api/v1/connector/fl-rounds/:roundTaskId/complete`，带上结果的 SM3 和连接器的 SM2 签名。
- **结果与展示：** 结果里包含本轮的 `localLoss` 和 `sampleCount`；编排器通过已有的 `/ws/secretflow` 网关推给前端，取代原来的日志桥。
- **请求体上限：** 这个接口单独放宽到 10MB；全局缺省的 100KB 装不下 LoRA 增量。
- **删除：** API 端对 agent 的远程调用、`AgentLogBridge`、`AGENT_GRPC_ROUTING`。gRPC 客户端代码移到连接器里，只用于院内调用。

### D4 下发任务的平台签名
- 签名内容：`{ participantId, taskKind, taskId, issuedAt, payload }` 经 `stableStringify` 后算 SM3，再用平台 CA 私钥做 SM2 签名。
- 连接器用部署固定的 `CONNECTOR_PLATFORM_CA_PUBKEY`（与 Wasm 变更共用）验签，并做三项检查：
  - `participantId` 必须是自己；
  - `issuedAt` 不能早于 10 分钟；
  - 按 `taskId` 去重。
- 任一检查失败：拒绝执行，本地审计记 `task-signature-invalid`，并上报失败，避免编排器空等。
- **备选：只靠 TLS**。TLS 在 Cloudflare 和 nginx 处就终结了，经过的代理可以篡改内容，必须有端到端签名。不采用。

### D5 连接器信道缺省强制证书认证
- 守卫缺省为强制模式。只有同时满足 `CONNECTOR_TOKEN_AUTH_ALLOWED=true` 并显式配置了 `CONNECTOR_PULL_TOKEN`，才允许令牌方式，代码里不再有缺省令牌。本地 e2e 和测试环境显式打开这个开关。
- 带请求体的上报接口，签名内容要包含请求体的 SM3，防止代理篡改。若现有签名串没有覆盖请求体，本次一并扩展。
- **证书签发：** 连接器所在主机本地生成 SM2 密钥对，私钥不出院；平台 CA 签发证书，指纹和私钥写入连接器配置。

### D6 院内调用的鉴权
- agent 的 gRPC 加服务端拦截器：元数据 `x-agent-token` 必须等于 `AGENT_SHARED_TOKEN`（每院一个随机值，不少于 32 字节，同时写进连接器和 agent 的配置）。缺失或不符返回 `UNAUTHENTICATED`。
- agent 只监听院内网络，不发布端口。
- L3 的 `RunLocalCausal` 走同一套鉴权。
- 日志 WS 默认关闭（`AGENT_WS_ENABLED=false`），只供本地调试。
- **备选：连接器与 agent 之间做 mTLS**。更强，但要多管理一套证书。两者同属一家医院、同一个运维方，第一版用共享凭证加网络隔离，mTLS 留作后续。

### D7 前置：控制面库持久化
- **为什么必须先做：** CA 根密钥在控制面 SQLite 里，API 容器重建就会重新生成。一旦重新生成，已签发的连接器证书、连接器上固定的平台公钥、平台签发的模块签名和任务签名会全部失效，按 fail-closed 规则所有任务都会失败。**这同样是 `connector-wasm-sandbox-disproportionality` 上线的前提。**
- **做法：** 给 ali29 的 API 服务挂载卷 `/repo/apps/api/data`。第一次挂载前，先用 `docker cp` 把运行中容器里的 `control-plane.db` 拷进卷里，保住现有的根密钥和数据。
- 这一步同时解决了「重建 API 会清空预跑任务」的老问题。

### D8 分阶段上线（每一步都可回退）
1. 控制面库持久化（D7）。
2. 发布新版 API：长轮询接口、任务签名、唤醒机制，守卫仍为非强制，旧连接器照常工作。
3. 为各院签发证书并完成配置，发布新版连接器（长轮询、验签、训练中转、agent 凭证）和 agent（拦截器）。
4. 守卫切换为强制，删除 API 的 agent 路由配置。
5. 旧接口在后续变更中删除。

## Risks / Trade-offs

- [唤醒丢失或重复下发] → 先登记等待者再查待办；领取时的状态变更保持原子；连接器按 `taskId` 去重。
- [长连接被代理切断] → 上限 25 秒；客户端退避重连；超时后返回空列表是正常结果。
- [API 多实例时进程内唤醒失效] → 当前单实例；如需扩容，改为 Redis 发布订阅，登记为后续事项。
- [证书上线出错把连接器锁在外面] → 先以非强制模式上线，最后一步才切强制；通过连接器注册表的在线状态监控。
- [联邦训练多了一跳，延迟增加] → 与单轮训练耗时相比可以忽略；超时与补偿沿用现有机制。
- [配置本院 agent 地址会顺带接通 L3] → L3 仍有 Cox 小样本返回固定值的问题，必须修复后才能打开，由任务清单单独控制。

## Migration Plan

按 D8 的五个阶段依次执行。
- **每阶段回滚：**
  - 阶段 2：换回上一版 API 镜像；
  - 阶段 3：换回上一版连接器和 agent 镜像；
  - 阶段 4：关掉强制开关。
- 阶段 1 的挂卷只是新增，不需要回滚。如需退回，改用卷内的库文件即可，数据仍在。

## Open Questions

- API 多实例时唤醒机制的选型：Redis 发布订阅，还是数据库轮询兜底。
- 连接器与 agent 之间何时升级为 mTLS。
- 国密 TLS（TLCP）的引入时机：取决于 Tongsuo 的可用性，以及合规上对「传输层国密」的要求。
