# DEPLOY.md — 端口与环境变量（单一事实源）

> **机器可校验的部署契约**。本文件 §2 ∪ §3 的键位集合与**代码读取点**做双向对拍，
> 不一致 = **测试红**（`node scripts/check-meta-docs.mjs`，已挂进根 `pnpm test`）。
>
> **改端口 / 新增读取的环境变量时，先改本文件**，再改样例文件与代码。
> 元语先行把对拍从事后检查变成事前设计。
>
> 关联：[`ARCHITECTURE.md`](./ARCHITECTURE.md)（服务拓扑与信任边界）· [`TRUST.md`](./TRUST.md)（密钥与敏感字段控制点）· [`DECISIONS.md`](./DECISIONS.md)。
>
> **真实值只进 `.env` / `apps/api/.env`（已忽略提交）与 `fly secrets`。
> 样例文件只放键位与占位，不放任何真值。**

---

## 1. 端口

> 来源列是对拍依据：标 `fly.toml` 的端口须在对应文件的 `internal_port` 中出现；
> 标 `docker-compose` 的须在 `docker-compose.yml` 的 `ports` 中出现；
> 标 `代码缺省` 的是读取点里的字面缺省值。

| 端口 | 服务 | 来源 | 说明 |
|---|---|---|---|
| `5020` | `medtrust-web` | `fly-services/web/fly.toml` | Next.js 控制台 |
| `5021` | `medtrust-api` | `fly-services/api/fly.toml` | NestJS 控制面 API；`PORT` 缺省同值 |
| `5022` | `medtrust-rws-worker-a` | `fly-services/connector/fly.rws-worker-a.toml` | RWS 计算 worker（瑞金侧） |
| `5022` | `medtrust-rws-worker-b` | `fly-services/connector/fly.rws-worker-b.toml` | RWS 计算 worker（华山侧） |
| `5022` | `connector` | 代码缺省 | `CONNECTOR_PORT` 缺省值 |
| `5023` | `medtrust-fl-server` | `fly-services/fl-server/fly.toml` | 联邦学习聚合服务 |
| `5024` | `medtrust-connector-a` | `fly-services/connector/fly.connector-a.toml` | 连接器（瑞金） |
| `5024` | `medtrust-connector-b` | `fly-services/connector/fly.connector-b.toml` | 连接器（华山） |
| `5026` | `medtrust-mlflow` | `fly-services/mlflow/fly.toml` | 实验跟踪 |
| `5027` | `medtrust-llm` | `fly-services/llm/fly.toml` | LLM 推理服务 |
| `5030` | `medtrust-connector-ml-ref` | `fly-services/connector-ml/fly.toml` | 连接器 ML 侧（Python） |
| `5031` | `e2e-api-gateway` | 代码缺省 | `API_PORT` 缺省值，仅 E2E 脚本用 |
| `8090` | `medtrust-chain` | `fly-services/chainmaker-node/fly.medtrust-chain.toml` | ChainMaker 节点 |
| `8200` | `vault` | `docker-compose` | HashiCorp Vault（本地 dev 模式） |
| `8200` | `medtrust-vault` | `fly-services/vault/fly.medtrust-vault.toml` | Vault（线上） |
| `9091` | `medtrust-fl` | `fly-services/fl-server/fly.medtrust-fl.toml` | Flower gRPC |
| `9092` | `medtrust-fl` | `fly-services/fl-server/fly.medtrust-fl.toml` | Flower HTTP |
| `9380` | `medtrust-fate-flow` | `fly-services/fate-flow/fly.toml` | FATE Flow |
| `5432` | `db` | `docker-compose` | PostgreSQL 15（本地） |

### 1.1 本地依赖事实

> 记录**实际发生了什么**，不是应该怎样。这类事实只能写在元语里——
> 代码看不出来、编排文件也看不出来，只有记下来才能阻止下一个人重新踩一遍。

| 服务 | 获取方式 | 启停 | 事实 |
|---|---|---|---|
| `vault` | `docker-compose.yml` | `docker compose up vault` | dev 模式，root token 硬编码为 `dev-token-12345`；`IPC_LOCK` 必须给，否则容器起不来 |
| `db` | `docker-compose.yml` | `docker compose up db` | postgres:15-alpine；库/用户/口令均为 `medtrust`，卷 `postgres_data` 持久化 |
| `synthea` | `docker-compose.yml` | `docker compose --profile synthea up synthea` | 在 `synthea` profile 下，默认不随 `up` 启动；产物落 `data/synthea/output` |
| 本地库文件 | 代码缺省 | — | `DATABASE_URL` / `CONTROL_PLANE_DB_URL` / `CONNECTOR_DB_URL` 缺省都是 `./data/*.db` 文件路径，不是 postgres 连接串——本地默认走文件库，起 `db` 容器不等于代码在用它 |

---

## 2. 环境变量（部署面）

> 「必需」判据：代码读取点**无字面缺省值** = 是。
> `secret` 列不可省略——使"哪些键是密钥"成为可查事实而非默认知识。

| 键 | 面 | 必需 | secret | 缺省 | 说明 |
|---|---|---|---|---|---|
| `AGENT_DATA_PATH` | agent | 否 | 否 | `/data/synthea/ingested` | Python 侧本地数据根 |
| `AGENT_GRPC_HOST` | agent | 否 | 否 | `0.0.0.0` | gRPC 监听地址 |
| `AGENT_GRPC_ROUTING` | api | 否 | 否 | 空 | 按参与方路由 gRPC 目标的映射串 |
| `AGENT_GRPC_URL` | api · connector | 否 | 否 | `127.0.0.1:5024` | 重计算节点 gRPC 地址 |
| `AGENT_LOCAL_PARTY` | agent | 是 | 否 | — | 本地参与方标识 |
| `AGENT_PARTICIPANT_ID` | agent | 否 | 否 | `local-agent` | 参与方 ID |
| `AGENT_WS_ADVERTISE_HOST` | agent | 否 | 否 | `127.0.0.1` | 对外通告的 WS 主机 |
| `AGENT_WS_HOST` | agent | 否 | 否 | `0.0.0.0` | WS 监听地址 |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` | api | 否 | 是 | 空 | SGX 实例编排凭证 |
| `ALIBABA_CLOUD_ACCESS_KEY_SECRET` | api | 否 | 是 | 空 | 同上 |
| `ALIBABA_CLOUD_REGION` | api | 是 | 否 | — | SGX 实例地域 |
| `ALIBABA_CLOUD_SGX_IMAGE_ID` | api | 否 | 否 | 空 | TEE 镜像 ID |
| `ALIBABA_CLOUD_SGX_INSTANCE_TYPE` | api | 否 | 否 | 空 | TEE 实例规格 |
| `AUDIT_LOG_UNMASKED_ACCESS` | api | 否 | 否 | 关（比较 `true`） | 是否审计明文访问，见 `TRUST.md` |
| `AWS_ACCESS_KEY_ID` | api | 是 | 是 | — | 对象存储凭证（S3 兼容） |
| `AWS_ENDPOINT_URL_S3` | api | 否 | 否 | `https://t3.storage.dev` | S3 兼容端点 |
| `AWS_REGION` | api | 否 | 否 | `auto` | 对象存储地域 |
| `AWS_SECRET_ACCESS_KEY` | api | 是 | 是 | — | 对象存储凭证 |
| `BUCKET_NAME` | api | 是 | 否 | — | 交付物桶名 |
| `CHAIN_CONTRACT_ADDRESS` | api | 是 | 否 | — | 存证合约地址 |
| `CHAIN_DEV_SIDECAR_URL` | api | 是 | 否 | — | 本地链 sidecar 地址 |
| `CHAIN_GROUP_ID` | api | 否 | 否 | `1` | 链群组 ID |
| `CHAIN_ID` | api | 否 | 否 | `1` | 链 ID |
| `CHAIN_SIDECAR_NODE2_URL` | api | 是 | 否 | — | 链 sidecar 节点 2 |
| `CHAIN_SIDECAR_NODE3_URL` | api | 是 | 否 | — | 链 sidecar 节点 3 |
| `CHAIN_SIDECAR_URL` | api | 是 | 否 | — | 链 sidecar 主节点 |
| `CONNECTOR_CATALOG_TOKEN` | connector | 是 | 是 | — | 目录拉取令牌 |
| `CONNECTOR_CATALOG_WARMUP` | connector | 否 | 否 | 空 | 启动时预热目录 |
| `CONNECTOR_DATA_ROOT` | connector | 是 | 否 | — | 域内数据根，**不出域** |
| `CONNECTOR_DB_URL` | database | 否 | 是 | `./data/connector-local.db` | 连接器本地库 |
| `CONNECTOR_ML_URL` | connector | 是 | 否 | — | 连接器 ML 侧地址 |
| `CONNECTOR_PARTICIPANT_ID` | connector | 否 | 否 | `p-ruijin` | 连接器所属参与方 |
| `CONNECTOR_POLL_INTERVAL_MS` | connector | 否 | 否 | `5000` | 任务轮询间隔 |
| `CONNECTOR_PORT` | connector | 否 | 否 | `5022` | 连接器监听端口 |
| `CONNECTOR_PULL_TOKEN` | api · connector | 否 | 是 | `dev-connector-token` | 连接器拉任务令牌 |
| `CONNECTOR_TASK_TIMEOUT_MS` | connector | 否 | 否 | `120000` | 单任务超时 |
| `XIAN_APP_KEY` | api | 否 | 是 | 空 | 西安节点能力中心分配的三方应用访问标识（PDF §5.2），空则开放接口返回 SYSTEM_ERROR |
| `XIAN_LOGIN_TICKET_TTL_MS` | api | 否 | 否 | `60000` | 免登一次性 ticket 有效期（毫秒），PDF §8 要求登录 URL 短时有效 |
| `XIAN_SM2_PRIVATE_KEY_PKCS8_B64` | api | 否 | 是 | 空 | 我方 SM2 私钥（PKCS#8 DER Base64），解密能力中心下发的敏感字段 |
| `XIAN_TENANT_ROLE_MAP` | api | 否 | 否 | 空 | 西安 tenantId → participantRole 映射 JSON；未命中默认 `consumer` |
| `XIAN_TIMESTAMP_TZ_OFFSET` | api | 否 | 否 | `+08:00` | X-Timestamp 解析时区（西安节点为北京时间） |
| `XIAN_TIMESTAMP_WINDOW_MS` | api | 否 | 否 | `300000` | X-Timestamp / X-Nonce 防重放时间窗（毫秒），PDF §5.2 建议 5 分钟 |
| `XIAN_WEB_BASE_URL` | api | 否 | 否 | `http://localhost:5020` | 免登 loginUrl 的 web 基地址（含协议，不含尾部斜杠） |
| `CONTROL_PLANE_DB_URL` | database | 否 | 是 | `./data/control-plane.db` | 控制面库 |
| `CONTROL_PLANE_TIMEOUT_MS` | connector | 否 | 否 | `15000` | 调控制面超时 |
| `CONTROL_PLANE_URL` | connector | 否 | 否 | `https://medtrust-api.fly.dev/api/v1` | 控制面地址 |
| `DATABASE_URL` | database | 否 | 是 | `./data/medtrust.db` | 主库连接 |
| `FATE_FLOW_TIMEOUT` | api | 是 | 否 | — | FATE Flow 调用超时 |
| `FATE_FLOW_URL` | api | 是 | 否 | — | FATE Flow 地址 |
| `FEATURE_BLOCKCHAIN` | api | 否 | 否 | `true` | 特性开关：区块链存证 |
| `FEATURE_FEDERATED_LEARNING` | api | 是 | 否 | — | 特性开关：联邦学习 |
| `FEATURE_FHIR` | api | 否 | 否 | `true` | 特性开关：FHIR |
| `FEATURE_MPC` | api | 否 | 否 | `true` | 特性开关：安全多方计算 |
| `FEATURE_TEE` | api | 否 | 否 | `true` | 特性开关：可信执行环境 |
| `FHIR_SERVER_URL` | api | 是 | 否 | — | FHIR 服务地址 |
| `FLOWER_API_KEY` | api | 是 | 是 | — | Flower 调用凭证 |
| `FLOWER_HEALTH_CHECK_INTERVAL` | api | 是 | 否 | — | Flower 健康检查间隔 |
| `FLOWER_MAX_CONNECTIONS` | api | 是 | 否 | — | Flower 最大连接数 |
| `FLOWER_MAX_RETRIES` | api | 否 | 否 | `3` | Flower 重试次数 |
| `FLOWER_REQUEST_TIMEOUT` | api | 是 | 否 | — | Flower 请求超时 |
| `FLOWER_SERVER_URL` | api | 是 | 否 | — | Flower 聚合服务地址 |
| `FLOWER_WEBHOOK_SECRET` | api | 是 | 是 | — | Flower 回调签名密钥 |
| `FL_POWER_MIN_SAMPLES` | api | 否 | 否 | `500` | 联邦训练最小样本量闸门 |
| `FL_STALE_MS` | api | 否 | 否 | `300000` | 联邦任务过期阈值 |
| `FRONTEND_URL` | api | 否 | 否 | `http://localhost:5020` | CORS / 回跳地址 |
| `JWT_EXPIRES_IN` | api | 是 | 否 | — | 访问令牌有效期 |
| `JWT_SECRET` | api | 是 | 是 | — | 令牌签名密钥 |
| `KEY_CACHE_TTL_SECONDS` | api | 否 | 否 | `300` | Vault 密钥缓存 TTL，见 `TRUST.md` |
| `LORA_DELIVERABLE_DIR` | api | 否 | 否 | `cwd()` 下相对目录 | LoRA 交付物落盘目录 |
| `LORA_DELIVERABLE_PREFIX` | api | 否 | 否 | `deliverables/` | 交付物对象前缀 |
| `MEDTRUST_MAX_DP_EPSILON` | api | 否 | 否 | 代码常量 | 差分隐私 ε 上限闸门 |
| `ML_BACKEND` | connector-ml | 是 | 否 | — | ML 后端选择 |
| `MP_SPDZ_GATEWAY_URL` | api | 是 | 否 | — | MP-SPDZ 网关地址 |
| `MP_SPDZ_TIMEOUT` | api | 否 | 否 | `60000` | MPC 超时 |
| `NEXT_PUBLIC_API_URL` | web | 否 | 否 | `http://localhost:5021/api/v1` | 前端 API 基址（构建期注入） |
| `NEXT_PUBLIC_CONNECTOR_DATA_PATH` | web | 否 | 否 | `/data/synthea/ingested` | 前端展示用数据路径 |
| `NEXT_PUBLIC_WS_URL` | web | 否 | 否 | `ws://localhost:5021` | 前端 WS 基址（构建期注入） |
| `NODE_ENV` | api · database | 否 | 否 | 非 `production` | 运行模式 |
| `PORT` | api | 否 | 否 | `5021` | API 监听端口 |
| `REFRESH_EXPIRES_DAYS` | api | 是 | 否 | — | 刷新令牌有效期（天） |
| `RWS_STALE_MS` | api | 否 | 否 | `300000` | RWS 任务过期阈值 |
| `SF_STATUS_TIMEOUT_MS` | api | 否 | 否 | `20000` | SecretFlow 状态轮询超时 |
| `SPACE_ID` | api | 否 | 否 | `sh-med` | 数据空间标识，进 CA 证书主体 |
| `VAULT_ADDR` | api | 否 | 否 | `http://localhost:8200` | Vault 地址 |
| `VAULT_ATTESTATION_KEY_PATH` | api | 是 | 否 | — | 存证签名密钥在 Vault 中的路径 |
| `VAULT_TOKEN` | api | 否 | 是 | 空 | Vault 访问令牌 |

---

## 3. 环境变量（测试面）

> 仅被 `*.spec.ts` / `*.test.ts` 与 `apps/api/scripts/` · `scripts/` 下的脚本读取，不参与生产部署。

| 键 | 必需 | 缺省 | 说明 |
|---|---|---|---|
| `API_PORT` | 否 | `5031` | E2E 网关脚本监听端口 |
| `CONSUMER_EMAIL` | 否 | `research@meddata-inst.edu.cn` | E2E 演示消费方账号 |
| `CONSUMER_PASSWORD` | 否 | `demo123456` | E2E 演示口令（**非生产凭证**） |
| `CONTRACT_HUASHAN` | 否 | 种子合约串 | E2E 用华山侧合约 ID |
| `CONTRACT_RUIJIN` | 否 | 种子合约串 | E2E 用瑞金侧合约 ID |
| `FISCO_BCOS_CHAIN_ID` | 否 | `1` | 链脚本用链 ID |
| `FISCO_BCOS_DEV_NODE_URL` | 否 | `http://localhost:8545` | 链脚本用本地节点 |
| `FISCO_BCOS_GROUP_ID` | 否 | `1` | 链脚本用群组 ID |
| `FISCO_BCOS_NODE1_URL` | 是 | — | 链脚本用节点 1 |
| `FISCO_BCOS_NODE2_URL` | 是 | — | 链脚本用节点 2 |
| `FISCO_BCOS_NODE3_URL` | 是 | — | 链脚本用节点 3 |
| `LADDER_FULL` | 否 | 开（比较 `0`） | E2E 阶梯是否跑全量 |
| `OPENCLAW_WEBHOOK_URL` | 否 | `http://localhost:8080/webhook/claude` | 本地通知钩子 |
| `PHARMA_SM2_PRIVATE_KEY` | 否 | 演示密钥表 | E2E 用药企 SM2 私钥（**非生产凭证**） |
| `POLL_INTERVAL_MS` | 否 | `5000` | E2E 轮询间隔 |
| `POLL_MAX` | 否 | `18` | E2E 轮询上限次数 |
| `RWS_CONTRACT_ID` | 是 | — | E2E 用 RWS 合约 ID |
| `RWS_PURPOSE` | 否 | 演示研究目的串 | E2E 用研究目的 |
| `SLACK_WEBHOOK_URL` | 否 | — | 本地通知钩子 |

---

## 4. 生产环境未落地要求

> 已知但尚未实施的生产要求。登记在此，避免上线时才发现。

| # | 要求 | 现状 |
|---|---|---|
| 1 | 样例文件与本文件键位对齐 | `.env.example`（31 键）、`apps/connector/.env.example`（5 键）合计 36 键，与本文件 98 键不等（`.env.fly.example` 已于 2026-07-31 废弃删除，见第 2 条）。**62 个已登记键不在任何样例文件**，**20 个样例文件键在扫描面内无人读取**（重叠仅 34 键）。校验器对这一面只报警告（见附录第 6 条），未判红。 |
| 2 | `.env.fly.example` 是漂移的平行副本，**已于 2026-07-31 废弃删除** | 其键名成套地停留在旧命名（`ALIYUN_*`/`FISCO_*`/`MPC_*`/`JWT_EXPIRATION`），且指向未部署的 app（`medtrust-lite-fate`/`medtrust-lite-fisco`/`medtrust-lite-mpc`）。`fly secrets list`（2026-07-31）确认线上用现命名——medtrust-api 的 9 个 secrets 全为现命名。**废弃理由**：fly 部署键集实际分散在各 `fly-services/*/fly*.toml` 的 `[env]` 段 + `fly secrets`，单份 `.env.fly.example` 无法表达"每 app 各自 env"，重写无意义。部署时以 `fly.toml [env]` + `fly secrets` 为准。 |
| 3 | `SMTP_*` 邮件通道 | 曾由 `.env.fly.example`（已废弃删除）登记 `SMTP_HOST`/`PORT`/`USER`/`PASS`，全仓无读取点。功能未实现或已废弃，未定。 |
| 4 | 本地默认走文件库而非 postgres | `docker-compose.yml` 提供 postgres，但三个 `*_DB_URL` 的代码缺省都是 `./data/*.db`。两条路径并存，未收敛。 |
| 5 | 密钥仍可由环境变量直接注入 | `JWT_SECRET` / `AWS_*` / `FLOWER_*` 等 `secret=是` 的键当前从 env 读取，未强制走 Vault。`TRUST.md` 的密钥控制点只覆盖 Vault 路径那条。 |
| 6 | toml 声明的部分 app 线上未部署 | `fly apps list`（2026-07-31）确认线上存在：`medtrust-api`/`chain`/`connector-a`/`connector-b`/`db`/`fl`/`mpc`/`rws-worker-a`/`rws-worker-b`/`vault`/`web`。`fly-services/` 下其余 toml（`connector-ref`/`connector-ml-ref`/`fate-flow`/`fl-server`/`lite*`/`llm`/`mlflow`/`mp-spdz-gateway`）线上不存在——参考架构或未上线服务，勿误以为已部署。 |

---

## 5. 忽略名单

> 不参与三方对拍的键。名单本身须非空可解析。

| 键 | 为什么忽略 |
|---|---|
| `STEAL` | 只作为**字符串字面量**出现在 `apps/connector/src/domain/**/*.spec.ts` 的夹具里——用例在验证语法校验器会拒绝用户算法里的 `process.env` 访问。不是本项目的读取点。 |
| `STEAL_KEY` | 同上。 |

---

## 附录：格式契约（校验器解析规则）

1. **§2 ∪ §3 的键位集合 == 代码扫描面的读取点集合（双向相等）。** 任一方向缺失 = 红。
2. §5 忽略名单不参与对拍。
3. §1 中来源列标 `fly-services/**/*.toml` 的端口，须在该文件的 `internal_port` 中出现；标 `docker-compose` 的须在 `docker-compose.yml` 的 `ports` 中出现。标 `代码缺省` 的不对拍。
4. **扫描面**（显式声明，校验器与本文件必须一致）：
   - 部署面：`apps/api/src` · `apps/web/src` · `apps/connector/src` · `apps/connector-ml` · `apps/agent` · `packages/database/src` · `packages/demo-scenario` · `packages/proto`
   - 测试面：`apps/api/scripts` · `scripts` · 以及部署面内的 `*.spec.ts` / `*.test.ts` / `__tests__/`
   - 排除：`node_modules` · `.next` · `dist` · `build` · `.turbo` · `coverage` · `.venv` · `__pycache__` · `output`
   - 排除目录 `video/` · `.claude/` · `fly-services/`：前两者是仓内旁支（视频生成、智能体工具），后者是基础设施模板，均不属应用配置面。
   - 读取点形态：`process.env.KEY` · `process.env['KEY']` · `configService.get('KEY')` · `os.environ[.get]('KEY')` · `getenv('KEY')`
   - **匹配 `process.env.KEY` 前先剥除字符串字面量**，否则 spec 夹具里的 `"process.env.STEAL"` 会被当成读取点（§5 即由此而来）。
5. **任一契约表解析为 0 行 = 格式契约破坏 = 红。**
6. §2/§3 ↔ 样例文件（`.env.example` · `.env.fly.example` · `apps/connector/.env.example`）**只报警告，不判红**：
   样例文件的键可能由仓外的 `fly secrets` 直接消费，工作区内无法判定其死活。
   判不准就判红会教会人"红是常态"，比没有检查更坏。当前差额记在 §4 第 1 条，**须随对齐进度收敛**。
