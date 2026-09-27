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
| `5022` | `medtrust-rws-worker-a` | `fly-services/connector/fly.rws-worker-a.toml` | NestJS 连接器 / RWS worker（华山，`p-huashan`，含 SoftwareTee） |
| `5022` | `medtrust-rws-worker-b` | `fly-services/connector/fly.rws-worker-b.toml` | NestJS 连接器 / RWS worker（瑞金，`p-ruijin`，含 SoftwareTee） |
| `5022` | `connector` | 代码缺省 | `CONNECTOR_PORT` 缺省值 |
| `5023` | `medtrust-fl-server` | `fly-services/fl-server/fly.toml` | 联邦学习聚合服务 |
| `5024` | `medtrust-connector-a` | `fly-services/connector/fly.connector-a.toml` | Python agent（华山）；**院内计算后端：只在参与方内部网络监听，不对平台暴露**（调用须带 `x-agent-token`） |
| `5024` | `medtrust-connector-b` | `fly-services/connector/fly.connector-b.toml` | Python agent（瑞金）；同上 |
| `5023` | `agent`（院内） | 代码缺省（`AGENT_WS_PORT`） | agent 训练日志 WS：**缺省关闭**（`AGENT_WS_ENABLED=false`），且只在院内网络 |
| `5025` | `omop-test-db` | 代码缺省 | 连接器真实 PostgreSQL 用例的 OMOP CDM 测试库（`apps/connector/scripts/omop-test-db.sh`，只绑 127.0.0.1） |
| `5026` | `medtrust-mlflow` | `fly-services/mlflow/fly.toml` | 实验跟踪 |
| `5027` | `medtrust-llm` | `fly-services/llm/fly.toml` | LLM 推理服务 |
| `5028` | `omop-onboarding-drill` | 代码缺省 | 接入手册干净环境演练库（`apps/connector/scripts/omop-onboarding-drill.sh`，只绑 127.0.0.1，演练完即删） |
| `5029` | `omop-view-benchmark` | 代码缺省 | 视图层对索引影响的合成千万行级基准库（`apps/connector/scripts/omop-view-benchmark.sh`，只绑 127.0.0.1，跑完即删） |
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
| `AGENT_GRPC_HOST` | agent | 否 | 否 | `0.0.0.0` | gRPC 监听地址 |
| `AGENT_GRPC_URL` | connector | 否 | 否 | `127.0.0.1:5024` | **本院**计算后端 gRPC 地址（只在参与方内部网络可达；控制面不再直连 agent） |
| `AGENT_SHARED_TOKEN` | connector · agent | 是 | 是 | — | 院内调用共享凭证（≥32 字节随机值），连接器调用 agent 时放 `x-agent-token` 元数据；agent 未配置即拒绝一切调用（fail-closed） |
| `AGENT_WS_ENABLED` | agent | 否 | 否 | `false` | 训练日志 WS 通道开关；缺省关闭（控制面不再连入 agent，日志改由连接器回传轮次指标），仅本地调试打开 |
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
| `AUTH_CAPTCHA_REQUIRED` | api | 否 | 否 | 非 production 默认 `false` | 登录图形验证码是否强制（P0-3） |
| `AWS_ACCESS_KEY_ID` | api | 是 | 是 | — | 对象存储凭证（S3 兼容） |
| `AWS_ENDPOINT_URL_S3` | api | 否 | 否 | `https://t3.storage.dev` | S3 兼容端点 |
| `AWS_REGION` | api | 否 | 否 | `auto` | 对象存储地域 |
| `AWS_SECRET_ACCESS_KEY` | api | 是 | 是 | — | 对象存储凭证 |
| `BUCKET_NAME` | api | 是 | 否 | — | 交付物桶名 |
| `CHAIN_SIDECAR_URL` | api | 是 | 否 | — | 链 sidecar 地址 |
| `CONNECTOR_CATALOG_TOKEN` | connector | 是 | 是 | — | 目录拉取令牌 |
| `CONNECTOR_CATALOG_WARMUP` | connector | 否 | 否 | 空 | 启动时预热目录 |
| `CONNECTOR_CDM_SOURCES` | connector | 否 | 否 | 空（= 无数据库数据源） | OMOP CDM 数据源配置（JSON 数组，omop-data-source-access）：`label/type/host/port/database/user/passwordEnv/cdmVersion/dbms/schemas[/statementTimeoutMs/maxConnections]`，**配置项白名单**。**不含口令**：口令放在 `passwordEnv` 指向的环境变量里（变量名由部署自定，按 secret 管理）；凭据永不进控制面（D7）。接入手册见 `docs/omop-cdm-onboarding.md` |
| `CONNECTOR_CDM_SOURCES_FILE` | connector | 否 | 否 | 空 | 同上，改从 JSON 文件读取（两者都配时 `CONNECTOR_CDM_SOURCES` 优先） |
| `CONNECTOR_CDM_REVERIFY_MS` | connector | 否 | 否 | `21600000`（6 小时） | CDM 数据源接入校验的周期复核间隔；`0` = 只在启动时校验。复核不过即刻不可用、目录覆盖元数据标「待刷新」 |
| `CONNECTOR_DATA_ROOT` | connector | 是 | 否 | — | 域内数据根，**不出域** |
| `CONNECTOR_DB_URL` | database | 否 | 是 | `./data/connector-local.db` | 连接器本地库 |
| `CONNECTOR_ML_URL` | connector | 是 | 否 | — | 连接器 ML 侧地址 |
| `CONNECTOR_PARTICIPANT_ID` | connector | 否 | 否 | `p-ruijin` | 连接器所属参与方 |
| `CONNECTOR_PORT` | connector | 否 | 否 | `5022` | 连接器监听端口 |
| `CONNECTOR_PULL_TOKEN` | api · connector | 否 | 是 | `dev-connector-token` | 连接器拉任务令牌 |
| `CONNECTOR_LOCAL_ADMIN_TOKEN` | connector | 否 | 是 | — | **院内**本地管理令牌（mdop-kernel/D-MDOP-4）：合约确认/拒绝/撤销走 `connector/mdop/contracts` 端点与 `pnpm --filter @medtrust/connector contracts` CLI。不配置则该组接口一律 401（fail-closed）。连接器端口 MUST NOT 发布到院内网之外（deploy/ali29 compose 的 internal 网络），本令牌保证的是「没有它就调不动」，网络可达性在部署面控制 |
| `CONNECTOR_MDOP_CONTRACT_POLICY_FILE` | connector | 否 | 否 | 空（= 人工确认） | 本地合约确认策略文件（JSON）：`{review:'auto'|'manual', autoConfirmContractIds:[...], note?}`。只有 `review=auto` **且**合约 id 被点名才自动确认，并在签名记录里标注 `review=auto(policy)`；文件不存在即人工确认 |
| `CONNECTOR_MDOP_KMS_REF` | connector | 否 | **C2 作业必需** | 空（= 未接入 → 封装一律 fail-closed） | 数据密钥保管方（KMS）的标识，写进 C2 信封的 `wrapped_key.kms`。**配了它才会装配本地保管口**（`InMemorySealKeyDepositor`，仅供本机演练）；生产必须换成医院自建或共管 KMS 的客户端实现——没有它，`seal` 算子拒绝产出信封（不「先出信封、密钥稍后补」） |
| `CONNECTOR_MDOP_KMS_PUBKEY` | connector | 否 | 否 | 空（= 未接入 → 见证一律判拒绝并留痕） | **KMS 公钥**，用于持有方**独立核验**节点上报的会话见证（任务 6.7 / D13）。MUST 来自部署配置或合约，**不得取自消息**；未配置时见证一律记 `WITNESS_REJECTED`（fail-closed，不「默认通过」） |
| `MDOP_KMS_PUBKEY` | api | 否 | 否 | 空（= 未接入 → 拒绝登记见证） | 平台侧用于验签会话见证的**同一把 KMS 公钥**（部署配置）。未配置即拒绝登记与转发（fail-closed）——平台不代替持有方下结论，只负责把可验签的对象送到 |
| `MDOP_ATTESTATION_VERIFIERS` | api | 否 | 否 | 空（= 无任何可信校验方 → 拒绝登记） | 逗号分隔的**可信校验方标识白名单**（KMS / 证明服务）。防止「自报我已校验」；会话见证路径以凭据签名里的 `kms` 字段比对这份名单 |
| `MDOP_ATTESTATION_MEASUREMENTS` | api | 否 | 否 | 空（= 不做注册中心度量白名单过滤） | 注册中心认可的**度量白名单**（`sm3:<64hex>`，逗号分隔）。证明登记与会话见证登记都按它过滤；它是**上限**，合约只能更严。**如实标注**：目前是注册中心白名单的**人工同步副本**（换版/吊销后须改配置并重新部署）；「同源签名 + 可吊销」尚未落地，属后续变更（tee-confidential-node design Non-Goals），不得对外声称已具备 |
| `TEE_NODE_PARTICIPANT_ID` | connector | 否 | 否 | 空（= 节点进程起不来） | **可信空间节点**的参与方 id（独立于数据持有方连接器的参与方）。节点组件与连接器同包但**独立部署**（独立进程、独立密钥、独立配置），组件入口见下 |
| `TEE_NODE_KEY_FILE` | connector | 否 | 是 | `data/tee-node-sm2.key` | 节点**自持身份私钥**文件（D-MDOP-3）。权限必须 **0600**，组/其他可读即拒绝加载；平台永不接触它，注册只提交公钥（`pnpm --filter @medtrust/connector tee-node -- keygen`） |
| `TEE_NODE_ATTESTATION_PROVIDER` | connector | 否 | 否 | `software`（需开发开关） | 证明提供者：`software`（开发替身，恒 `software/none`，**过不了 C2 判定**）或 `hardware`（真实证明代理，未注入实现即报错）。生产环境用 `software` 会被配置闸门直接拒绝启动 |
| `TEE_NODE_KMS_MODE` | connector | 否 | 否 | `local-dev`（需开发开关） | KMS 客户端模式：`local-dev`（本机演练，仅供合成数据）或 `remote`（持有方自建/共管 KMS，未注入实现即报错，D-TEE-1） |
| `TEE_NODE_KMS_REF` | connector | 否 | 否 | `kms://local-dev` | KMS 标识（写进信封的 `wrapped_key.kms` 与释放凭据的 `kms` 字段；平台按 `MDOP_ATTESTATION_VERIFIERS` 白名单比对它） |
| `TEE_NODE_KMS_PUBKEY` | connector | 否 | 否 | 空（= 节点拒绝启动） | 核对 KMS 释放凭据用的**公钥**（部署配置）。MUST NOT 取自消息；缺它就起不来——节点不接受「先跑起来再补验签」 |
| `TEE_NODE_ALLOW_DEV_PROVIDERS` | connector | 否 | 否 | `false` | 显式允许**开发用替身**（软件证明 / 本机演练 KMS）。缺省 false；即便设为 true，`NODE_ENV=production` 下仍会被拒绝（软件隔离不是 TEE） |
| `TEE_NODE_CERT_FINGERPRINT` | connector | 否 | 否 | 空（= 节点拉不到消息） | 平台 CA 签发的**节点证书指纹**：节点长轮询 `/connector/tasks/pending` 的出站认证头（与连接器同一套口径）。缺它就拉不到中继消息（fail-closed，不降级成令牌） |
| `TEE_NODE_PLATFORM_PUBKEY` | connector | 否 | 否 | 空（= 拒绝处理任何下发消息） | **平台节点公钥**（部署配置）：用于验证平台下发的 `C2EnvelopeRelay` 等信封。MUST NOT 取自消息本身；缺它则拒绝处理（fail-closed） |
| `TEE_NODE_DATA_DIR` | connector | 否 | 是 | `data/tee-node` | 节点**本地状态目录**（任务 3.16）：`node-state.json`（回执链 + 未销毁制品 + 中继去重表）与导出给离线核验工具的 `receipts-<作业>.json`。目录 `0700`、文件 `0600`；里面**没有私钥、没有明文投影**。挂载持久卷，否则重启即丢一手链 |
| `TEE_NODE_REGISTRY_PUBKEY` | connector | 否 | 否 | 空（= 算子清单一律不采纳） | **注册中心公钥**（部署配置）：节点核验随长轮询下发的算子清单签名（与连接器侧 `CONNECTOR_REGISTRY_PUBKEY` 同一把）。MUST NOT 取自消息；缺它就一条清单都不采纳 → 每个阶段都会以 `E_OP_NOT_WHITELISTED` 被拒（fail-closed） |
| `TEE_NODE_PARTICIPANT_KEYS_FILE` | connector | 否 | 否 | 空（= 没有可验的持有方公钥） | **参与方登记公钥表**（部署锚，JSON `{ "<URN>": "<公钥hex>" }`）：节点用它们验**合约副本的持有方签名**与**C2 信封签名**。MUST NOT 取自消息——公钥若随消息下来，平台就能「换公钥 + 换条款 + 补签名」让节点接受一份持有方从未签过的合约。缺它则合约副本与信封都验不过（要约会被拒） |
| `TEE_NODE_MODULE_DIR` | connector | 否 | 否 | 空（= 本地模块库为空） | **本地模块库目录**（任务 3.12g）：算子模块按 `<sm3hex>.wasm` 命名放在这里。执行**只从本地取字节**（不现取平台），文件名的摘要就是准入决定；目录为空则任何 wasm 算子都跑不了 |
| `TEE_NODE_MEASUREMENTS` | connector | 否 | 否 | 空（= 不接受任何 C2 要约） | 本节点**允许运行的执行环境度量**（`sm3:<64hex>`，逗号分隔；注册中心白名单的本地副本）。复核与凭证期望按它比对；空 = 一律拒（fail-closed，不退化成「不限」） |
| `TEE_NODE_VERIFIER_URL` | connector | 否 | 否 | 空（= 不跑证明探针） | **校验方的证明服务地址**（任务 5.9 / D-TEE-6）：节点真跑一次证明后交给它，由它对摘要签名背书并推给平台登记。**不设默认值**（默认值会把证明送错地方）；缺它则不跑探针——此时只能靠上一次会话见证的登记，注册过期后新作业会在编译期被拒 |
| `CONNECTOR_MDOP_WATERMARK` | connector | 否 | 否 | `wm:connector` | C2 信封的水印前缀（形如 `wm:site-a:sh-med`），实际写入值会附上当天日期。用于事后追溯「这份密文出自哪个站点、哪一天」 |
| `MDOP_ENABLED` | api · connector | 否 | 否 | `false` | **MDOP 内核总开关**（mdop-kernel）：连接器侧 `false` 时完全不处理 MDOP 信封（旧管线不受影响），`true` 时才走「合约要约 → 七项本地复核 → 凭证校验 → 执行 → C3 投递 → 销毁」链路。上线顺序：平台先开（只是登记），连接器逐院开；任何一侧未开都 fail-closed 不产生结果 |
| `CONNECTOR_CERT_FINGERPRINT` | connector | 否 | 否 | 空 | 连接器 SM2 证书指纹（P1-4） |
| `CONNECTOR_SM2_PRIVATE_KEY` | connector | 否 | 是 | 空 | 连接器 SM2 私钥（P1-4） |
| `CONNECTOR_SM2_PRIVATE_KEY_FILE` | connector | 否 | 是 | `data/connector-sm2.key` | 连接器 SM2 私钥**文件**（D-MDOP-3 参与方密钥自持，`node apps/connector/scripts/keygen.mjs` 生成）。权限必须 **0600**，组/其他可读即拒绝加载；与 `CONNECTOR_SM2_PRIVATE_KEY` 二选一（内联优先）。平台已删除代生成路径：注册不带公钥即 400 |
| `CONNECTOR_VERSION` | connector | 否 | 否 | `1.0.0` | 心跳上报版本（P1-9） |
| `CONNECTOR_OFFLINE_MS` | api | 否 | 否 | `60000` | 心跳超时标离线阈值（P1-9），默认 60s |
| `CONNECTOR_TASK_TIMEOUT_MS` | connector | 否 | 否 | `120000` | 单任务超时 |
| `CONNECTOR_LONG_POLL_WAIT_MS` | api · connector | 否 | 否 | `25000` | 长轮询等待上限（服务端硬上限 25s，客户端同值用于 HTTP 超时 = 该值 + 10s） |
| `CONNECTOR_TASK_CONCURRENCY` | connector | 否 | 否 | `4` | 连接器执行队列并发上限（领任务与执行解耦，执行期间仍在线） |
| `CONNECTOR_TOKEN_AUTH_ALLOWED` | api · connector | 否 | 否 | `false` | **迁移期开关**：true 时允许令牌降级（须同时显式配置 `CONNECTOR_PULL_TOKEN`）；缺省 false = 强制证书认证 |
| `CONNECTOR_PLATFORM_CA_PUBKEY` | connector | 是 | 否 | — | **CA 根钥**公钥（SM2 hex）。三钥分离后（D-MDOP-3）它**只验连接器证书链**，不再签/验任务与算法模块。**只从部署配置读，不从任务通道取**（algorithm-sandbox/D-CN-2）。三把公钥均取自 `GET /api/v1/attestation/trust-anchor` |
| `CONNECTOR_PLATFORM_NODE_PUBKEY` | connector | 是 | 否 | — | **平台节点密钥**公钥，验下发任务签名（含执行凭证/吊销名单/合约副署）。未配置则拒绝全部下发任务（fail-closed）。用 CA 根钥签出的对象一律拒绝 |
| `CONNECTOR_REGISTRY_PUBKEY` | connector | 是 | 否 | — | **注册中心密钥**公钥，验算子清单与算法模块签名（即 P-CTL-6 的「专用算法签名密钥」，已与 CA 根钥分离）。未配置则拒绝一切沙箱执行（fail-closed） |
| `PLATFORM_KEK` | api | 是 | 是 | — | 平台三把私钥（CA 根钥 / 平台节点密钥 / 注册中心密钥）的 **SM4 密钥加密密钥**（D-MDOP-3）。三把私钥以 `enc:v1:<iv>:<cipher>` 密文落库，本键是唯一解密来源：**生产环境未配置则平台拒绝启动**；开发环境回落固定 KEK 并显式告警。非 32 hex 的口令按 SM3 派生（前 32 hex = 16 字节）。轮换须同时重签三钥并按用途重新分发公钥 |
| `SM2_LEGACY_CUTOFF` | connector · api | 否 | 否 | `2026-09-24T00:00:00Z` | 离线核验器 `scripts/verify-endorsement.mjs` 接受**旧格式签名**的截止时间（切换点）。早于该时间的链上记录才允许旧格式（不做 Z_A、原始 r‖s）；切换后的记录只认国标格式，否则判定失败（防降级） |
| `CONNECTOR_SANDBOX_TIMEOUT_MS` | connector | 否 | 否 | `10000` | Wasm 算法模块执行时限，超时 terminate worker 并判任务失败 |
| `CONNECTOR_SANDBOX_MAX_MEMORY_MB` | connector | 否 | 否 | `64` | 沙箱内存上限（模块只导入宿主提供的这块内存），所需内存超限在调用前拒绝 |
| `RWS_ENDORSEMENT_REQUIRED` | api | 否 | 否 | `false` | **迁移期开关**（on-chain-provider-endorsement/D-RWS-5）：缺省渐进——连接器不带结果级背书只记告警、任务不破；两院连接器升级后置 `true` 切 fail-closed（无/错背书即拒该院贡献）。注意：**有背书任何时候都必须验过**，本开关只管「缺背书」是否放行 |
| `MODULE_LOCAL_BUILD_ALLOWED` | api | 否 | 否 | `false` | 允许控制面**自行编译**第三方模块源码（third-party-module-admission）。缺省 **false** 且生产必须保持 false：`cargo build` 会执行第三方 `build.rs` / proc-macro，是闸 1/闸 3 都不覆盖的编译期执行点，不能放在持有 CA 私钥、对外提供 HTTP 的控制面容器里（挂 docker.sock 去"隔离"更糟 —— 等同宿主 root）。生产路径：独立构建环境跑 `admit-cli.mjs` → `POST /module-admission/submissions/:id/attest-build` 交 ≥2 份产物，控制面自算 SM3、自比对、自过闸 1。仅本地 demo/e2e 可置 true |
| `WASM_ALGORITHMS_ROOT` | api | 否 | 否 | `packages/wasm-algorithms` | 第三方模块准入的**构建执行体**所在包根（third-party-module-admission 闸 2）：控制面触发构建时另起进程跑 `scripts/admit-cli.mjs`（锁定工具链、断网 hermetic、双构建器对拍 SM3）。与 `WASM_ALGORITHMS_DIR`（产物分发目录）不同：前者是**源码构建**入口，后者是**产物装载**目录 |
| `WASM_ALGORITHMS_DIR` | api | 否 | 否 | `packages/wasm-algorithms/build` | 算法模块产物目录（清单 + .wasm），API 启动时装载为模块注册表；缺省按仓内布局定位 |
| `SF_ROUND_TIMEOUT_MS` | api | 否 | 否 | `120000` | 联邦训练单院单轮等待上限；超时的医院踢出本轮（下一轮仍可参与） |
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
| `NEXT_PUBLIC_API_URL` | web | 否 | 否 | `http://localhost:5021/api/v1` | 前端 API 基址（构建期注入）；线上用同源相对路径 `/api/v1`，由 nginx 在服务器本机转给 API，避免第二个公网域名与跨域预检 |
| `NEXT_PUBLIC_CONNECTOR_DATA_PATH` | web | 否 | 否 | `/data/synthea/ingested` | 前端展示用数据路径 |
| `NEXT_PUBLIC_ENABLE_DEMO_ACCOUNTS` | web | 否 | 否 | 空 | 是否展示演示账号快速填充（P0-1） |
| `NEXT_PUBLIC_WS_URL` | web | 否 | 否 | `ws://localhost:5021` | 前端 WS 基址（构建期注入）；留空且 API 为同源相对路径时跟随页面同源（`/ws` 由 nginx 转 API） |
| `NODE_ENV` | api · database | 否 | 否 | 非 `production` | 运行模式 |
| `PORT` | api | 否 | 否 | `5021` | API 监听端口 |
| `REFRESH_EXPIRES_DAYS` | api | 是 | 否 | — | 刷新令牌有效期（天） |
| `RWS_STALE_MS` | api | 否 | 否 | `300000` | RWS 任务过期阈值 |
| `SEED_DEMO_USERS` | api | 否 | 否 | 非 production 默认 `true` | 是否播种演示账号（P0-1） |
| `SILKROAD_NODE_ENDPOINT` | api | 否 | 是 | 空 | 丝路数港区域节点接口基址（P2-2；生产未配置则互认能力 fail-closed） |
| `SILKROAD_NODE_ID` | api | 否 | 否 | `silk-road` | 丝路数港节点标识（P2-2） |
| `SMS_GATEWAY_URL` | api | 否 | 是 | 空 | 短信网关连接串（P1-2 手机快捷登录；生产未配置则 fail-closed） |
| `SMTP_URL` | api | 否 | 是 | 空 | 邮件服务连接串（P0-6 忘记密码；生产未配置则 fail-closed） |
| `SPACE_ID` | api | 否 | 否 | `sh-med` | 数据空间标识，进 CA 证书主体 |
| `SWAGGER_ENABLED` | api | 否 | 否 | 非 production 默认 `true` | Swagger 文档开关（P0-10） |
| `TRUST_PROXY` | api | 否 | 否 | 空（不信任代理） | 反向代理跳数或 express `trust proxy` 值；线上经 nginx 一跳设 `1`，限流才按真实客户端 IP 计 |
| `VAULT_ADDR` | api | 否 | 否 | `http://localhost:8200` | Vault 地址 |
| `VAULT_TOKEN` | api | 否 | 是 | 空 | Vault 访问令牌 |

---

## 3. 环境变量（测试面）

> 仅被 `*.spec.ts` / `*.test.ts` 与 `apps/api/scripts/` · `scripts/` 下的脚本读取，不参与生产部署。

| 键 | 必需 | 缺省 | 说明 |
|---|---|---|---|
| `AGENT_E2E_GRPC_URL` | 否 | — | 连接器 → 真 agent gRPC 的训练切片端到端用例（`apps/connector/src/domain/fl-round/fl-round-agent-grpc.spec.ts`）所连的 agent 地址；agent 须以 `AGENT_SHARED_TOKEN=agent-e2e-token` 启动（**非生产凭证**）；未设置则跳过 |
| `API_PORT` | 否 | `5031` | E2E 网关脚本监听端口 |
| `CDM_DRILL_DATABASE_URL` | 否 | — | 接入手册干净环境演练库的管理员连接串，由 `sh apps/connector/scripts/omop-onboarding-drill.sh` 起库并注入（`127.0.0.1:5028`，演练完即删，**非生产凭证**）；未设置则跳过演练用例 |
| `CDM_TEST_DATABASE_URL` | 否 | — | 连接器真实 PostgreSQL 用例（接入校验 / 投影下推 / 覆盖统计 / results 清理）的测试库管理员连接串；`sh apps/connector/scripts/omop-test-db.sh` 起库后为 `postgres://postgres:admin@127.0.0.1:5025/omop`（**非生产凭证**）；未设置则跳过这些用例 |
| `CONSUMER_EMAIL` | 否 | `research@meddata-inst.edu.cn` | E2E 演示消费方账号 |
| `CONSUMER_PASSWORD` | 否 | `demo123456` | E2E 演示口令（**非生产凭证**） |
| `CONTRACT_HUASHAN` | 否 | 种子合约串 | E2E 用华山侧合约 ID |
| `CONTRACT_RUIJIN` | 否 | 种子合约串 | E2E 用瑞金侧合约 ID |
| `LADDER_FULL` | 否 | 开（比较 `0`） | E2E 阶梯是否跑全量 |
| `NCBI_API_KEY` | 否 | — | PubMed AMR 文献抓取 API key（`scripts/amr/fetch_pubmed.py`，提升限流至 10 req/s） |
| `NCBI_EMAIL` | 否 | — | NCBI eutils 联系邮箱（同上） |
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
| 1 | 样例文件与本文件键位对齐 | 样例文件与本文件的键集仍不等（`.env.fly.example` 已于 2026-07-31 废弃删除，见第 2 条）。校验器 2026-09-25 实测：**70 个已登记键不在任何样例文件**、**2 个样例文件键在扫描面内无人读取**。校验器对这一面只报警告（见附录第 6 条），未判红。 |
| 2 | `.env.fly.example` 是漂移的平行副本，**已于 2026-07-31 废弃删除** | 其键名成套地停留在旧命名（`ALIYUN_*`/`FISCO_*`/`MPC_*`/`JWT_EXPIRATION`），且指向未部署的 app（`medtrust-lite-fate`/`medtrust-lite-fisco`/`medtrust-lite-mpc`）。`fly secrets list`（2026-07-31）确认线上用现命名——medtrust-api 的 9 个 secrets 全为现命名。**废弃理由**：fly 部署键集实际分散在各 `fly-services/*/fly*.toml` 的 `[env]` 段 + `fly secrets`，单份 `.env.fly.example` 无法表达"每 app 各自 env"，重写无意义。部署时以 `fly.toml [env]` + `fly secrets` 为准。 |
| 3 | `SMTP_*` 邮件通道 | 曾由 `.env.fly.example`（已废弃删除）登记 `SMTP_HOST`/`PORT`/`USER`/`PASS`，全仓无读取点。功能未实现或已废弃，未定。 |
| 4 | 本地默认走文件库而非 postgres | `docker-compose.yml` 提供 postgres，但三个 `*_DB_URL` 的代码缺省都是 `./data/*.db`。两条路径并存，未收敛。 |
| 5 | 密钥仍可由环境变量直接注入 | `JWT_SECRET` / `AWS_*` / `FLOWER_*` 等 `secret=是` 的键当前从 env 读取，未强制走 Vault。`TRUST.md` 的密钥控制点只覆盖 Vault 路径那条。 |
| 7 | 院内节点运行加固（ali29） | 2026-09-18 已应用 `deploy/ali29/compose.hardening.yaml`：4 个院内容器非 root、只读根、`cap_drop ALL`、`no-new-privileges`、内存/CPU/进程数上限、不发布主机端口、每院独立 internal 网络（仅通本院节点与 api）；连接器本地审计库改命名卷。**余项**：控制面库（`/repo/apps/api/data`）仍需挂卷持久化（否则重建 API 会重新生成 CA 根密钥，见 `openspec/changes/outbound-longpoll-agent-auth` D7）；主机对 80 以外端口无防火墙，外网隔离只靠云安全组。 |
| 6 | toml 声明的部分 app 线上未部署 | `fly apps list`（2026-07-31）确认线上存在：`medtrust-api`/`chain`/`connector-a`/`connector-b`/`db`/`fl`/`mpc`/`rws-worker-a`/`rws-worker-b`/`vault`/`web`。`fly-services/` 下其余 toml（`connector-ref`/`connector-ml-ref`/`fate-flow`/`fl-server`/`lite*`/`llm`/`mlflow`/`mp-spdz-gateway`）线上不存在——参考架构或未上线服务，勿误以为已部署。 |

---

## 4.1 SM2 国标化 + 三钥分离的切换流程（含回滚）

> 这是 **BREAKING** 切换（openspec `mdop-kernel` 任务 4.7 / D-MDOP-3）：签名口径从
> 「不做 Z_A、原始 r‖s」变成 **GM/T 0003 的 Z_A 预处理 + GM/T 0009 的 DER**；平台一把
> CA 根钥拆成**用途互斥的三把**。平台与连接器必须**同一批次**升级——只升一边，该边签出的
> 对象会被另一边按用途/格式拒绝（fail-closed，不会静默降级）。

### 切换前

1. 备份控制面库（三把私钥密文所在的 `cp_ca_keypair` 行）与**旧镜像**：
   `cp data/control-plane.db data/control-plane.db.pre-sm2-switch`；记下当前镜像 tag。
2. 生成并保存 `PLATFORM_KEK`（32 hex 或任意口令，按 secret 管理）：**丢失它等于丢失三把私钥**。
3. 从 `GET /api/v1/attestation/trust-anchor` 取切换后的三把公钥
   （`caPublicKey` / `platformNodePublicKey` / `registryPublicKey`）备用。

### 切换

4. 平台侧：配好 `PLATFORM_KEK` 后重启 API。启动时会把历史明文 CA 私钥**原地加密**为
   `enc:v1:` 密文，并生成缺失的平台节点密钥与注册中心密钥。核对
   `CaService.keyStorageReport()` 三项均为 `encrypted`。
5. 连接器侧（每院）：`pnpm --filter @medtrust/connector keygen` 生成本院私钥（0600，平台不参与）；
   提交公钥重新注册：`node apps/connector/scripts/register.mjs --connector-id <id>
   --participant-id <pid> --token <operator JWT>`。注册响应里**不应**出现任何私钥字段。
6. 连接器侧：配置三把平台公钥 `CONNECTOR_PLATFORM_CA_PUBKEY` /
   `CONNECTOR_PLATFORM_NODE_PUBKEY` / `CONNECTOR_REGISTRY_PUBKEY`，并把
   `CONNECTOR_SM2_PRIVATE_KEY` 换成 `CONNECTOR_SM2_PRIVATE_KEY_FILE`（0600）；重启连接器。
7. 验收：长轮询日志应显示 `platformKey=on`；下发一个任务，连接器验签通过。若日志出现
   「未配置 CONNECTOR_PLATFORM_NODE_PUBKEY」或「任务签名无法用部署固定的平台节点公钥验证」，
   说明第 6 步公钥贴错或连接器未重启。

### 回滚

8. 关掉 `MDOP_ENABLED` 不影响旧管线；但**签名口径的回滚必须整体回退**：恢复旧镜像 +
   恢复 `data/control-plane.db.pre-sm2-switch` + 各院恢复旧连接器镜像与旧私钥备份。
   三样缺一不可——旧镜像验不了国标签名，新库里的密文私钥旧镜像也读不了。
9. 因此**在切换稳定运行一段时间之前不要删除旧镜像与旧私钥备份**。历史链上对象的旧格式验签
   由 `sm2VerifyHistorical` 与 `scripts/verify-endorsement.mjs` 保留（截止时间见
   `SM2_LEGACY_CUTOFF`），不依赖回滚。

> **本地演练现状**：`apps/connector/src/domain/sm2-switch-drill.spec.ts` 复刻平台侧签发
> （同一载荷口径 + 国标签名 + 按用途用钥）并走连接器真实验签入口，断言「对应用途验得过 /
> 用错密钥拒收 / 旧格式在线上被拒」。这是本机可跑的那部分；**三进程（API + 两院连接器）
> 实机演练尚未执行**。

> **2026-09-25 更新**：三进程实机演练已在 **ali29** 执行完毕（见 §4.2）。切换后的
> 旧管线（RWS 任务）与新的 MDOP 通道同机跑通。

---

## 4.2 MDOP 内核上线（ali29，2026-09-25）

> 对应 openspec `mdop-kernel` 任务 11.5。**顺序不能颠倒**：平台先开只是登记能力，
> 连接器逐院开；任何一侧未开都不产生结果（fail-closed）。

### 上线前

1. 备份三样（缺一不可回滚）：`pg_dump`（业务库）、`apps/api/data/control-plane.db`
   （控制面库：三把私钥密文 + 合约 + MDOP 全套表）、各容器 `env/*.env`。
2. 旧镜像打 tag：`medtrust-api:pre-mdop-<date>`、`medtrust-rws-worker-{a,b}:pre-mdop-<date>`。

### 上线

3. 平台：`PLATFORM_KEK` 写入 `env/medtrust-api.env`（16 字节 hex），`MDOP_ENABLED=true`，
   重建并启动 API。验收：`GET /api/v1/attestation/trust-anchor` 返回三把公钥；
   `cp_ca_keypair` 三列私钥都是 `enc:v1:` 密文（旧的明文启动时被原地加密）。
4. 连接器（每院）：`MDOP_ENABLED=true`、`CONNECTOR_PLATFORM_NODE_PUBKEY`、
   `CONNECTOR_REGISTRY_PUBKEY`、`CONNECTOR_LOCAL_ADMIN_TOKEN`、
   `CONNECTOR_MDOP_CONTRACT_POLICY_FILE=data/mdop-contract-policy.json`；重启后日志应出现
   `platformKey=on`、`L1.5 算子已注册：declassify.small_cell@1.0.0, source.dataset@1.0.0`、
   `吊销名单已更新 version=N`。
5. 演示合约自动确认策略（**仅演示**）：把**点名的 seed 合约 id** 写进各院
   `mdop-contract-policy.json` 的 `autoConfirmContractIds`。策略文件缺省不存在 = 人工确认。
6. 白名单初始化（每院，院内端点，`X-Connector-Admin-Token`）：
   `POST /connector/mdop/operators` 登记 wasm 摘要（`rws.disproportionality@1.0.0` 的
   `sm3:<64hex>`）与两个 system 算子引用（`source.dataset@1.0.0`、`declassify.small_cell@1.0.0`）。
7. 合约要约：`POST /api/v1/contracts/{id}/mdop/offer` → 连接器自动/人工确认 →
   `GET /api/v1/contracts/{id}/mdop` 应为 `mdopStatus=active` 且有
   `holderSignature` + `platformCountersignature`。
8. 跑一次 L1.5：`POST /api/v1/mdop/jobs/l15`（用途**逐字等于**合约用途码）→
   `POST /api/v1/mdop/jobs/{id}/compile`（编译成功即自动发出片段要约）→
   观察 `SUBMITTED→COMPILED→NEGOTIATING→TICKETED→RUNNING→SUCCEEDED` →
   `POST /api/v1/mdop/jobs/{id}/purge` 补发销毁指令 → `PURGED`。
9. 验收（§11.5「核验锚定」）：`GET /api/v1/mdop/jobs/{id}` 返回
   `chains[]` 逐院 `valid:true`（回执链接得上）与 `anchors[]` `status:anchored` 且带**真实
   交易号与区块高度**（链不可达时是 `pending` + 补偿队列，**不会有伪造交易号**）。

### 演练记录（2026-09-25，ali29）

| 项 | 结果 |
|---|---|
| 作业 | `job-muh30wmv-7d3b8270`，`planHash sm3:ba10762d…`，终态 `PURGED` |
| 阶段 | 两院各 3 跳（`src_*` / `l15_*` / `dec_*`）全部 `SUCCEEDED`（attempt 1） |
| 执行 | 数据源 5000 行/院 → **wasm 沙箱**跑 `rws.disproportionality@1.0.0`（模块 `b2760b0c…`）→ 输出闸门 `minCell=5` → C3 |
| 合并 | 平台 `merge.disproportionality@1.0.0`：cohort 10000、事件 586、PRR 2.115、ROR 2.244、IC 0.374、`signal=true` |
| 凭证 | `tkt-8aed4eaf…` ISSUED，含两院持有方签名（各带数据快照）+ 平台签名 |
| 销毁 | 两院制品销毁并回签名回执 → `PURGED`；各院本地 `local_mdop_artifact` 该作业 0 行 |
| 回执链 | 每院 8 条成链，平台 `verifyChain` 逐院 `valid:true` |
| 锚定 | 两院链头分别上链：`9b13d55e…`（block 23）与 `f03e8ede…`（block 24） |

### 回滚

10. 关 `MDOP_ENABLED`（平台与连接器）→ 旧管线（RWS 任务页）不受影响，MDOP 作业不再产生。
11. 整体回退（连签名口径一起）：恢复 §4.1 第 8 条的旧镜像 + 旧控制面库 + 各院旧私钥。
12. 只回退 MDOP（保留国标签名）：恢复 `control-plane.db` 备份（去掉 MDOP 表与
    `mdopTerms`），平台与连接器镜像回退到 pre-mdop tag。

---

## 4.3 可信空间节点（C2）+ KMS 的部署与回滚

> 对应 openspec `tee-confidential-node` 任务 9.1/9.4/9.5。**本节是待上线清单，不是演练记录**：
> 硬件（CSV/TDX/SEV-SNP 机型）与 KMS 归属尚未落定（D-TEE-3 / D-TEE-1），因此**没有任何一行
> 是实测通过**；本仓目前只有「节点会话运行时 + 替身提供者 + 本机演练 KMS」的可复跑用例
> （`apps/connector/src/mdop/node/c2-session.spec.ts`），它证明的是**接口与协议够用**，
> **不是 C2 可用**。

### 组件清单（§9.1）

| # | 组件 | 归属与要求 | 现状 |
|---|---|---|---|
| 1 | **可信空间节点** | 独立于数据持有方连接器的一等参与方（自己的 URN、自持密钥 0600、注册只提交公钥、能力通告 `tee{kind, min_tcb}`）；由**中立第三方或监管侧**运营（D-TEE-1） | 运行时会话（`mdop/node/node-session.ts`）、**组件可部署部分**（`src/tee-node/`：身份 / 配置闸门 / 两处接缝 / 会话与见证上报 / 本地持久化；`pnpm --filter @medtrust/connector tee-node -- keygen\|advertise`）、**C2 数据面传输**（平台中继 + 节点长轮询）与**消息处置**（`tee-node/node-messages.ts`：要约复核与签名接受 / 凭证校验 / 信封绑定 / 阶段派发会合 / 销毁回执）均已落地；注册/心跳 HTTP（`tee-node/registration.ts`，`tee-node -- register|heartbeat`）与守护进程长驻循环（`tee-node/runtime.ts`，`tee-node -- serve`）也已落地（任务 3.1 / 3.18）。**仍缺**：真实证明代理与真实 KMS——在接通前不得通告任何 `tee{kind}`（软件提供者的通告恒为 `null`） |
| 2 | **KMS** | 数据持有方自建，或与节点运营方共管（门限/双签）；**平台 MUST NOT 持有解密能力** | 客户端接缝 + 凭据核对 + 判定引擎已落地；真实 KMS 待选型与部署 |
| 3 | 主机 | 启用 CSV / TDX / SEV-SNP 之一；厂商证明服务可达，或证明凭据可离线核验（D-TEE-3 共同前置） | **待采购/运维**（机型、region、审批周期均为 `[需申请]`） |
| 4 | 网络 | **只接受数据持有方连接器的出站投递**（不开入站）；节点不出入站端点，医院侧不直连节点（D13 方案 ①已否决） | 与既有「连接器只外联」取向一致，落地时按院内网络策略核 |
| 5 | 合约 | 必须声明 `attestation_policy`（`tee[]` + `min_tcb` 按链 + 可选 `allowed_measurements`）；未声明即无 C2 资格（fail-closed）。**接收方名单必须包含可信空间节点与平台**：持有方侧的本地复核会判「C2 边的对端是否在合约接收方/参与方之列」，节点不在名单里 → 各院直接拒该片段 | 已落地（协议核心 + 平台要约 + 控制台策略面板） |

### 上线步骤（**未执行**，硬件与 KMS 到位后按序做）

1. 备份：`pg_dump`、`apps/api/data/control-plane.db`、各容器 `env/*.env`；旧镜像打 tag
   `medtrust-api:pre-c2-<date>`、`medtrust-connector:pre-c2-<date>`。
2. KMS：按 D-TEE-1 定归属并部署；导出**KMS 公钥**（写入节点与各院的**部署配置或合约**，
   **不从平台消息里取**）。
3. 节点：部署节点组件，`tee-node -- keygen` 生成自持密钥（0600）→ `tee-node -- register --token <operator JWT>`
   注册（**只提交公钥**；把返回的证书指纹写进 `TEE_NODE_CERT_FINGERPRINT`）→ `tee-node -- heartbeat`
   上报能力通告（**由真跑一次证明得出**：接入真实证明前 `tee` 恒为 `null`，不得虚标）；
   **然后 `tee-node -- serve` 长驻运行**（任务 3.18：心跳 60s、证明探针 5min、长轮询 25s、
   收到消息即处置；收到 SIGINT/SIGTERM 时先停循环再退出）。启动前准备好四份本地事实：
   `TEE_NODE_PARTICIPANT_KEYS_FILE`（参与方公钥表）、`TEE_NODE_MODULE_DIR`（按 `<sm3hex>.wasm` 放模块）、
   `TEE_NODE_MEASUREMENTS`（允许的度量）、`TEE_NODE_VERIFIER_URL`（证明服务地址，缺省不跑探针）。
   启动后自检「证明 → KMS 释放 → 解封 → 节点内执行 → 发布审查 → 只出 C3」。
   离线核验：`tee-node -- export-receipts <jobId>` → `node apps/connector/scripts/verify-receipt-chain.mjs --receipts <导出文件> --pubkey <节点公钥>`。
4. 合约：在控制台为生效合约声明 C2 策略（链型多选、按链最低可信基、允许度量清单），
   **重新发起要约**（条款变更 ⇒ 各院需重签）。
5. 各院：连接器开 C2 相关配置（`CONNECTOR_MDOP_TEE_*` 一类键**待组件落地时登记进 §2**），
   并确认「连接器仍恒不通告 TEE 能力」（能力通告恒为 `null` 是设计意图，不是待办）。
   节点侧另需两处**部署侧事实**（由装配方注入，均不取自消息）：① **持有方登记公钥表**——
   节点要验 C2 信封的持有方签名；② **查询预算口径**——`数据集×快照 → 上限与申请方`，
   由节点账本在执行/出口时 assert→charge（D-TEE-2）。缺任一项，节点会拒收该作业的 C2 输入。
   再加三处**节点本地事实**：③ `TEE_NODE_REGISTRY_PUBKEY`（注册中心公钥，核验随长轮询下发的算子清单；
   不配则一条清单都不采纳 → 每个阶段都会被 `E_OP_NOT_WHITELISTED` 拒）；④ **本地模块库**——
   按摘要放置算子模块字节（例如配对模块 `paired-cohort.wasm`），执行只从本地取、不现取平台；
   ⑤ 吊销名单随长轮询自动刷新（平台节点公钥验签、版本单调），**未同步到有效名单前拒绝执行 wasm**。
6. **作业之前的证明登记（D-TEE-6）**：编译期放置 C2 要求节点有一份**未过期**的证明登记，而会话见证
   要等一次作业绑定的密钥释放——因此必须先把这条路铺好，否则**任何**作业都会在编译期被判
   `E_ATTESTATION_FAILED`：
   - 校验方（KMS / 证明服务）对证明摘要签名，推送到 `POST /api/v1/mdop/attestations`（部署侧接口，
     operator JWT + **部署配置里的 KMS 公钥**验签；平台不自己验 quote）。校验方标识须在
     `MDOP_ATTESTATION_VERIFIERS` 白名单内，度量须在 `MDOP_ATTESTATION_MEASUREMENTS` 内。
   - 节点侧跑探针（`tee-node/attestation-probe.ts`）：真跑一次证明 → 带节点签名交给校验方的证明服务；
     校验方验 quote 后签名背书并推送平台。**探针节拍必须短于背书有效期**（有效期由校验方按部署策略给，
     分钟～小时级），否则登记会过期、作业在编译期被拒。节点验完的背书会核对「绑定的是本节点 + 本次 quote」。
   - 运维检查：`POST /mdop/attestations` 的返回里有 `expiresAt`；控制台/日志按该时刻排探针节拍。
   - **登记上链与补锚**：证明摘要（`SM3(quote_digest)`）在登记时随存证适配器上链，回写 `chain_tx`；
     链不可达时**登记照常生效**、链上字段留空并进补偿队列，由服务自己的 30 分钟节拍补齐
     （`MdopAttestationService#retryPendingAnchors`，幂等、不写假交易号）。上线后自查
     「登记行 `chain_tx` 是否在 30 分钟内出现」——一直为空说明链侧没通，而不是「锚定已放弃」。
   - **collateral 新鲜度（D-TEE-3 残余项 ①，2026-09-26 补）**：真实信任根实现 MUST 声明两件事——
     **必须随带的材料种类**（`crl` / `qvl` / `vcek` / `reference-values`）与**离线刷新窗口**（分钟），
     并用 `createHardwareAttestationVerifier` 产出「验 quote + 判材料时效」的校验器。缺料、已过
     `next_update`、超出刷新窗口、时间倒挂一律拒（`E_ATTESTATION_FAILED`，KMS 不释放密钥）；
     **只验 quote、不看材料时效的校验器不得接真实链**（它只用于开发替身）。运维侧同时要定
     「谁多久进院内网刷新一次」并把厂商根的带入过程留档——策略进配置，**程序进台账**。
7. 演练顺序（§9.2 → §9.3）：先单院 MVP（合成数据），再两院跨院主体配对（合成数据）；
   验收点：作业终态 `PURGED`、各院与节点回执链 `valid`、产出物可离线核验
   （节点回执链 + 证明摘要 `quote_digest` + 平台锚定的交易号）。
8. **真实数据闸门**：REG 路径（REGULATORY REG-08）与医院**书面接受**运营方与 KMS 归属完成前，
   **只跑合成数据**（§9.5）。

### 回滚（关闭 C2 的方式）

9. **只关 C2、不动既有 C3 链路**（推荐）：合约取消 `attestation_policy` 声明（重新要约 ⇒ 各院重签）
   + 可信空间节点下线。效果：新作业的 C2 边在编译期即被拒（`E_CAPABILITY_MISMATCH`），
   医院本地执行出 C3 的老链路不受影响。
10. KMS 侧同步：停发新释放凭据与新的证明背书（已有凭据按 10 分钟有效期自然失效，无需回收；
   已推送的背书到期即失效，不必回收）。
11. 节点下线前必须先跑完销毁：平台上对在途作业补发 `PurgeOrder`，收齐节点销毁回执后才拆机器；
    **不得**直接关机了事（否则「销毁」只是运维口头的）。
12. 整体回退：恢复 `control-plane.db` 备份 + 旧镜像（同时回退证明登记表与凭证扩展）。

### 如实边界登记（§9.5）

- **不得**在文档、合约、控制台文案里出现「数据没有出医院」「数据仍在自己院内」这类表述：
  C2 换掉的是**信任锚**（厂商证明根 + 代码度量 + 运营方 + KMS 释放策略），合规定性是
  **委托处理 / 数据出域**，需额外的协议与告知。
- **侧信道不在防护范围**：TDX/SEV-SNP 不防内存访问模式分析；进入节点的必须是最小投影，
  并靠查询预算与发布审查兜底，不得宣称「进 TEE 就绝对安全」。
- **仅当节点部署在院内时**：证明链的**厂商证明服务可达性 / collateral 离线核验**方案未落地前不得开工（D-TEE-3 院内路径前置）。云上默认形态 collateral 可在线取（TDX 走 PCCS/Intel PCS；CSV 走厂商证明服务/自托管 trustee；SEV-SNP 走 AMD KDS），该项不是共同前置。回执链离线核验工具（`apps/connector/scripts/verify-receipt-chain.mjs`）已落地，不构成本条解锁。
- 本仓已落地的替身实现（`LocalDevKms`、测试用硬件提供者替身）**只能**用于开发与合成数据演练；
  真实数据下必须替换为厂商证明链 + 持有方自建/共管 KMS。
- **生产禁例运维事实（T3，2026-09-27）**：医院连接器一旦设 `NODE_ENV=production`，在硬件 `TeeEnclave` 接上之前会直接起不来——`SoftwareTee` 构造即抛错（故意 fail-closed，防静默用软件实现充当 C2）。当前 Fly 演示镜像刻意 `NODE_ENV=development`（`fly-services/connector/fly.toml`），不受影响。本条不改变 D9 的如实标注口径（院内仍标 `software`），也不表示「生产可以继续用软件实现当 C2」。

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
