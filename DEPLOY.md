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
| `5022` | `medtrust-rws-worker-a` | `fly-services/connector/fly.rws-worker-a.toml` | NestJS 连接器 / RWS worker（示范甲，`p-demohospa`，含 SoftwareSealedCompute） |
| `5022` | `medtrust-rws-worker-b` | `fly-services/connector/fly.rws-worker-b.toml` | NestJS 连接器 / RWS worker（示范乙，`p-demohospb`，含 SoftwareSealedCompute） |
| `5022` | `connector` | 代码缺省 | `CONNECTOR_PORT` 缺省值 |
| `5023` | `medtrust-fl-server` | `fly-services/fl-server/fly.toml` | 联邦学习聚合服务 |
| `5024` | `medtrust-connector-a` | `fly-services/connector/fly.connector-a.toml` | Python agent（示范甲）；**院内计算后端：只在参与方内部网络监听，不对平台暴露**（调用须带 `x-agent-token`） |
| `5024` | `medtrust-connector-b` | `fly-services/connector/fly.connector-b.toml` | Python agent（示范乙）；同上 |
| `5023` | `agent`（院内） | 代码缺省（`AGENT_WS_PORT`） | agent 训练日志 WS：**缺省关闭**（`AGENT_WS_ENABLED=false`），且只在院内网络 |
| `5025` | `omop-test-db` | 代码缺省 | 连接器真实 PostgreSQL 用例的 OMOP CDM 测试库（`apps/connector/scripts/omop-test-db.sh`，只绑 127.0.0.1） |
| `5026` | `medtrust-mlflow` | `fly-services/mlflow/fly.toml` | 实验跟踪 |
| `5027` | `medtrust-llm` | `fly-services/llm/fly.toml` | LLM 推理服务 |
| `5028` | `omop-onboarding-drill` | 代码缺省 | 接入手册干净环境演练库（`apps/connector/scripts/omop-onboarding-drill.sh`，只绑 127.0.0.1，演练完即删） |
| `5029` | `omop-view-benchmark` | 代码缺省 | 视图层对索引影响的合成千万行级基准库（`apps/connector/scripts/omop-view-benchmark.sh`，只绑 127.0.0.1，跑完即删） |
| `5030` | `medtrust-connector-ml-ref` | `fly-services/connector-ml/fly.toml` | 连接器 ML 侧（Python） |
| `5031` | `e2e-api-gateway` | 代码缺省 | `API_PORT` 缺省值，仅 E2E 脚本用 |
| `5032` | `medtrust-chat-agent` | `fly-services/chat-agent/fly.toml` | 对话式任务配置 Agent（`apps/chat-agent`）：自然语言 → Card Message → MDOP 作业；无 `ANTHROPIC_API_KEY` 时走确定性回退（不出域） |
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
| 数据库驱动 | 代码强制 | — | `DATABASE_URL` / `CONTROL_PLANE_DB_URL` / `CONNECTOR_DB_URL` 必须为 PostgreSQL URL；生产拒绝 SQLite 文件路径 |

---

## 2. 环境变量（部署面）

> 「必需」判据：代码读取点**无字面缺省值** = 是。
> `secret` 列不可省略——使"哪些键是密钥"成为可查事实而非默认知识。

| 键 | 面 | 必需 | secret | 缺省 | 说明 |
|---|---|---|---|---|---|
| `AGENT_DEID_AUDIT_PATH` | agent | 否 | 否 | `data/deid-audit.jsonl` | 院内脱敏审计链落盘路径（append-only，SM3 前向链接）；`:memory:` = 只在进程内（仅测试） |
| `AGENT_DEID_DICTIONARY_DIR` | agent | 否 | 否 | `data/deid-dictionaries` | 院内脱敏词表目录（Phase 2）。文件命名规则：`<dictionaryId 的 ':' 换成 '_'>.v<version>.txt`（例：`deid:cn-names:v2` → `deid_cn-names.v2.txt`），每行一个词。**词表内容留在医院**，平台只签摘要；agent 按 `dictionaryRef` 读文件并核对 SM3，缺失或对不上即 DENIED |
| `AGENT_DEID_SALTS_JSON` | agent | 否 | 是 | `{}` | 盐引用 → 盐 的本地映射（JSON），键即规格里的 `saltRef`。**盐归医院**：平台只下发 `saltRef`，永不下发盐；缺盐即 DENIED。生产应改为本地 Vault/KMS adapter |
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
| `APP_VERSION` | api | 否 | 否 | `1.0.0` | 区域节点状态上报里的平台版本号（ndi-platform-state-report） |
| `CHAIN_SIDECAR_URL` | api | 是 | 否 | — | 链 sidecar 地址 |
| `NDI_ORG_CODE` | api · connector | 否 | 否 | 空 | NDI-TR-2025-04 机构码。**空 = 对外上报/推送 fail-closed**（目录推送、区域状态上报不生成标识），本地功能不受影响 |
| `NDI_ID_SCHEME_VERSION` | api | 否 | 否 | `draft-1` | NDI 标识编码方案版本；未知取值直接拒绝装配（04 正式文本到位后升版） |
| `REGION_STATE_REPORT_INTERVAL_MS` | api | 否 | 否 | `5000` | 平台→区域节点状态上报周期（钳制 1s–300s）；`SILKROAD_NODE_ENDPOINT` 为空时不启动定时器 |
| `CONNECTOR_CATALOG_PEERS` | connector | 否 | 否 | 空 | 连接器只读目录服务的对端白名单（逗号分隔 participantId）；空 = 只靠 `CONNECTOR_PULL_TOKEN` 鉴权 |
| `CONNECTOR_CATALOG_SERVICE` | connector | 否 | 否 | `off` | 连接器只读目录服务开关（NDI-TR-2025-05 §7.2）；`off` 时路由 404。开启后仅院内网络可达 |
| `CONNECTOR_CATALOG_TOKEN` | connector | 是 | 是 | — | 目录拉取令牌 |
| `CONNECTOR_CATALOG_WARMUP` | connector | 否 | 否 | 空 | 启动时预热目录 |
| `CONNECTOR_CDM_SOURCES` | connector | 否 | 否 | 空（= 无数据库数据源） | OMOP CDM 数据源配置（JSON 数组，omop-data-source-access）：`label/type/host/port/database/user/passwordEnv/cdmVersion/dbms/schemas[/statementTimeoutMs/maxConnections]`，**配置项白名单**。**不含口令**：口令放在 `passwordEnv` 指向的环境变量里（变量名由部署自定，按 secret 管理）；凭据永不进控制面（D7）。接入手册见 `docs/omop-cdm-onboarding.md` |
| `CONNECTOR_CDM_SOURCES_FILE` | connector | 否 | 否 | 空 | 同上，改从 JSON 文件读取（两者都配时 `CONNECTOR_CDM_SOURCES` 优先） |
| `CONNECTOR_CDM_REVERIFY_MS` | connector | 否 | 否 | `21600000`（6 小时） | CDM 数据源接入校验的周期复核间隔；`0` = 只在启动时校验。复核不过即刻不可用、目录覆盖元数据标「待刷新」 |
| `CONNECTOR_DEID_MODE` | connector | 否 | 否 | `builtin` | 脱敏通道：`builtin` = 连接器内 `Deidentifier` 逐行脱敏（演示/小数据/无 agent 部署）；`agent` = 脱敏下沉到院内 Python agent，按平台签发的规格执行，**禁止**连接器自己脱敏（agent 不可达/规格不可用/回执不符即任务失败，不退回弱脱敏）。非法值不静默回落，直接判配置错误 |
| `CONNECTOR_DATA_ROOT` | connector | 是 | 否 | — | 域内数据根，**不出域** |
| `CONNECTOR_DB_URL` | connector | 否 | 是 | `postgres://…/medtrust_connector_<site>` | 连接器本地 PostgreSQL；每院独立库与凭据 |
| `CONNECTOR_ML_URL` | connector | 是 | 否 | — | 连接器 ML 侧地址 |
| `CONNECTOR_PARTICIPANT_ID` | connector | 否 | 否 | `p-demohospb` | 连接器所属参与方 |
| `CONNECTOR_PORT` | connector | 否 | 否 | `5022` | 连接器监听端口 |
| `CONNECTOR_POWER_PSEUDONYM_KEY` | connector | 否 | 是 | — | 电力包键控假名密钥（HMAC-SM3，≥ 32 字符，D-CN-8）：窃电疑似户 id 与 DP 种子由它派生，平台不持有。**同一联盟的各节点须配置同一把**（否则跨节点同户对不上）。不配置时电力降密环拒绝出域（fail-closed），不影响医疗路径 |
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
| `TEE_NODE_DEV_KMS_KEY_FILE` | connector | 否 | 是 | 空（= `local-dev` 模式不装配） | 本机演练 KMS 的 SM2 私钥文件（0600）。只有 `TEE_NODE_KMS_MODE=local-dev` 且显式配置时才装配；它不会让软件证明节点获得 C2 资格，信任根仍为空 |
| `TEE_NODE_DEV_KMS_KEYS_FILE` | connector | 否 | 是 | 空（= 空密钥表） | 本机演练 KMS 的可选密钥表 `{ "<key_id>": "<32-byte hex>" }`；仅用于合成数据联调，真实数据不得使用 |
| `TEE_NODE_ALLOW_DEV_PROVIDERS` | connector | 否 | 否 | `false` | 显式允许**开发用替身**（软件证明 / 本机演练 KMS）。缺省 false；即便设为 true，`NODE_ENV=production` 下仍会被拒绝（软件隔离不是 TEE） |
| `TEE_NODE_CERT_FINGERPRINT` | connector | 否 | 否 | 空（= 节点拉不到消息） | 平台 CA 签发的**节点证书指纹**：节点长轮询 `/connector/tasks/pending` 的出站认证头（与连接器同一套口径）。缺它就拉不到中继消息（fail-closed，不降级成令牌） |
| `TEE_NODE_PLATFORM_PUBKEY` | connector | 否 | 否 | 空（= 拒绝处理任何下发消息） | **平台节点公钥**（部署配置）：用于验证平台下发的 `C2EnvelopeRelay` 等信封。MUST NOT 取自消息本身；缺它则拒绝处理（fail-closed） |
| `TEE_NODE_DATA_DIR` | connector | 否 | 是 | `data/tee-node` | 节点**本地状态目录**（任务 3.16）：`node-state.json`（回执链 + 未销毁制品 + 中继去重表）与导出给离线核验工具的 `receipts-<作业>.json`。目录 `0700`、文件 `0600`；里面**没有私钥、没有明文投影**。挂载持久卷，否则重启即丢一手链 |
| `TEE_NODE_REGISTRY_PUBKEY` | connector | 否 | 否 | 空（= 算子清单一律不采纳） | **注册中心公钥**（部署配置）：节点核验随长轮询下发的算子清单签名（与连接器侧 `CONNECTOR_REGISTRY_PUBKEY` 同一把）。MUST NOT 取自消息；缺它就一条清单都不采纳 → 每个阶段都会以 `E_OP_NOT_WHITELISTED` 被拒（fail-closed） |
| `TEE_NODE_PARTICIPANT_KEYS_FILE` | connector | 否 | 否 | 空（= 没有可验的持有方公钥） | **参与方登记公钥表**（部署锚，JSON `{ "<URN>": "<公钥hex>" }`）：节点用它们验**合约副本的持有方签名**与**C2 信封签名**。MUST NOT 取自消息——公钥若随消息下来，平台就能「换公钥 + 换条款 + 补签名」让节点接受一份持有方从未签过的合约。缺它则合约副本与信封都验不过（要约会被拒） |
| `TEE_NODE_MODULE_DIR` | connector | 否 | 否 | 空（= 本地模块库为空） | **本地模块库目录**（任务 3.12g）：算子模块按 `<sm3hex>.wasm` 命名放在这里。执行**只从本地取字节**（不现取平台），文件名的摘要就是准入决定；目录为空则任何 wasm 算子都跑不了 |
| `TEE_NODE_MEASUREMENTS` | connector | 否 | 否 | 空（= 不接受任何 C2 要约） | 本节点**允许运行的执行环境度量**（`sm3:<64hex>`，逗号分隔；注册中心白名单的本地副本）。复核与凭证期望按它比对；空 = 一律拒（fail-closed，不退化成「不限」） |
| `TEE_NODE_VERIFIER_URL` | connector | 否 | 否 | 空（= 不跑证明探针） | **校验方的证明服务地址**（任务 5.9 / D-TEE-6）：节点真跑一次证明后交给它，由它对摘要签名背书并推给平台登记。**不设默认值**（默认值会把证明送错地方）；缺它则不跑探针——此时只能靠上一次会话见证的登记，注册过期后新作业会在编译期被拒 |
| `TEE_NODE_TDX_SIDECAR` | connector | 否 | 否 | 空（= 未接线，`hardware` 模式下起不来） | **TDX 工具链 sidecar 路径**（`apps/connector/tools/tdx-sidecar`，在 TDVM 内构建）。配置后 `tee-node` 的证明提供者经它向 `/dev/tdx_guest` 取真实 quote 与 collateral；不配即保持「未接入真实证明代理」的抛错行为 |
| `TEE_NODE_KMS_URL` | connector | 否 | 否 | 空（= 未接线，`remote` 模式下起不来） | **密钥释放地址**（远程 KMS 客户端）。节点把释放请求连同本次证明的原生 quote 交过去；回来的凭据用 `TEE_NODE_KMS_PUBKEY` 核验。仅在同时配置了 `TEE_NODE_TDX_SIDECAR` 时生效 |
| `CONNECTOR_MDOP_KMS_DEPOSIT_URL` | connector | 否 | 否 | 空（= 本地演练口，只留摘要） | **密钥托付地址**（医院连接器 → 密钥保管方）。配置后封装算子把数据密钥用 `CONNECTOR_MDOP_KMS_PUBKEY` SM2 加密、持有方签名后托付；保管方未明确接受即拒绝封装 |
| `TEE_VERIFIER_ID` | connector | 是 | 否 | — | 校验方标识：写进背书的 `verifier`，必须在平台 `MDOP_ATTESTATION_VERIFIERS` 白名单内 |
| `TEE_VERIFIER_KEY_FILE` | connector | 否 | 否 | `data/tee-verifier-sm2.key` | 校验方 SM2 私钥文件（0600，`tee-verifier -- keygen` 生成）；其公钥即节点的 `TEE_NODE_KMS_PUBKEY` 与平台的 `MDOP_KMS_PUBKEY` |
| `TEE_VERIFIER_TDX_SIDECAR` | connector | 是 | 否 | — | 校验方本机的 `tdx-sidecar` 路径（`verify` 子命令：验签链到 Intel 证明根，collateral 由校验方自己向 Intel PCS 取） |
| `TEE_VERIFIER_NODE_KEYS_FILE` | connector | 是 | 否 | — | 已登记节点公钥表（JSON：`participantId → SM2 公钥`）。探针签名用它验，**不取自消息** |
| `TEE_VERIFIER_MEASUREMENTS` | connector | 否 | 否 | 空（= 一律拒） | 允许背书的度量白名单（逗号分隔，`sm3:<64hex>`；TDX 为 `sm3(MR_TD)`） |
| `TEE_VERIFIER_MIN_TCB` | connector | 是 | 否 | — | TDX 的 TCB 下限（点分数字，以实测 quote 回填） |
| `TEE_VERIFIER_COLLATERAL_MAX_STALENESS_MIN` | connector | 否 | 否 | `60` | 节点随带 collateral 的最大陈旧度（分钟），超窗即拒 |
| `TEE_VERIFIER_ENDORSEMENT_TTL_MIN` | connector | 否 | 否 | `30` | 背书有效期（分钟）。节点探针节拍（默认 5 分钟）必须短于它 |
| `TEE_VERIFIER_BIND` | connector | 否 | 否 | `127.0.0.1` | 监听地址（跨域部署时绑私网地址，不绑公网） |
| `TEE_VERIFIER_PORT` | connector | 否 | 否 | `5024` | 监听端口，路径固定 `/attest` |
| `TEE_VERIFIER_PLATFORM_URL` | connector | 否 | 否 | 空（= 不推平台） | 平台 API 根（含 `/api/v1`）。配置后每份背书推到 `POST /mdop/attestations/endorsements` 登记（背书自带签名，校验方不持平台账号） |
| `TEE_VERIFIER_KMS_REF` | connector | 否 | 否 | `kms://unconfigured` | 试点形态下本进程兼做密钥保管方时的标识：写进释放凭据的 `kms`，须等于各院信封的 `wrapped_key.kms`（`CONNECTOR_MDOP_KMS_REF`）与节点的 `TEE_NODE_KMS_REF` |
| `TEE_VERIFIER_HOLDER_KEYS_FILE` | connector | 否 | 否 | 空（= 不接受任何托付） | 数据持有方公钥表（JSON：`participantId → SM2 公钥`）。`POST /keys` 的托付签名用它验 |
| `CONNECTOR_MDOP_WATERMARK` | connector | 否 | 否 | `wm:connector` | C2 信封的水印前缀（形如 `wm:site-a:sh-med`），实际写入值会附上当天日期。用于事后追溯「这份密文出自哪个站点、哪一天」 |
| `USAGE_CONTROL_ENGINE` | connector | 否 | 否 | `legacy` | 使用控制引擎（ndi-usage-control-engine）：`legacy` 行为不变（缺省）；`shadow` 只记录与 legacy 的分歧；`v1` 引擎判定生效。未知取值按 legacy 处理 |
| `MDOP_ENABLED` | api · connector | 否 | 否 | `false` | **MDOP 内核总开关**（mdop-kernel）：连接器侧 `false` 时完全不处理 MDOP 信封（旧管线不受影响），`true` 时才走「合约要约 → 七项本地复核 → 凭证校验 → 执行 → C3 投递 → 销毁」链路。上线顺序：平台先开（只是登记），连接器逐院开；任何一侧未开都 fail-closed 不产生结果 |
| `MDOP_MAX_CONTRIBUTION_SIZE` | api | 否 | 否 | `104857600`（100 MB） | 节点间安全聚合密文 blob 大小上限（字节）。协议 v0.3 §7.7.5：超过上限返回 `E_PAYLOAD_TOO_LARGE`。防止恶意节点上传 GB 级密文撑爆对象存储 |
| `ORCHESTRATION_FORCE_CHANNEL` | api | 否 | 否 | 空 | **迁移回滚演练开关**（D-MDOP-7）：形如 `rws.disproportionality=legacy`，逗号分隔多个 key。**仅非生产生效**，用于下线闸门⑤「切回旧通道跑通一次」的演练；台账不因此改变（legacy 仍只减不增）。生产环境该变量被忽略 |
| `CONNECTOR_CERT_FINGERPRINT` | connector | 否 | 否 | 空 | 连接器 SM2 证书指纹（P1-4） |
| `CONNECTOR_SM2_PRIVATE_KEY` | connector | 否 | 是 | 空 | 连接器 SM2 私钥（P1-4） |
| `CONNECTOR_SM2_PRIVATE_KEY_FILE` | connector | 否 | 是 | `data/connector-sm2.key` | 连接器 SM2 私钥**文件**（D-MDOP-3 参与方密钥自持，`node apps/connector/scripts/keygen.mjs` 生成）。权限必须 **0600**，组/其他可读即拒绝加载；与 `CONNECTOR_SM2_PRIVATE_KEY` 二选一（内联优先）。平台已删除代生成路径：注册不带公钥即 400 |
| `CONNECTOR_VERSION` | connector | 否 | 否 | `1.0.0` | 心跳上报版本（P1-9） |
| `CONNECTOR_OFFLINE_MS` | api | 否 | 否 | `180000` | 心跳超时标离线阈值（P1-9 / ndi-platform-state-report），缺省 3 × 心跳周期（180s）；一次丢包不再直接判离线 |
| `CONNECTOR_TASK_TIMEOUT_MS` | connector | 否 | 否 | `120000` | 单任务超时 |
| `CONNECTOR_LONG_POLL_WAIT_MS` | api · connector | 否 | 否 | `25000` | 长轮询等待上限（服务端硬上限 25s，客户端同值用于 HTTP 超时 = 该值 + 10s） |
| `CONNECTOR_TASK_CONCURRENCY` | connector | 否 | 否 | `4` | 连接器执行队列并发上限（领任务与执行解耦，执行期间仍在线） |
| `CONNECTOR_TOKEN_AUTH_ALLOWED` | api · connector | 否 | 否 | `false` | **迁移期开关**：true 时允许令牌降级（须同时显式配置 `CONNECTOR_PULL_TOKEN`）；缺省 false = 强制证书认证 |
| `CONNECTOR_PLATFORM_CA_PUBKEY` | connector | 是 | 否 | — | **CA 根钥**公钥（SM2 hex）。三钥分离后（D-MDOP-3）它**只验连接器证书链**，不再签/验任务与算法模块。**只从部署配置读，不从任务通道取**（algorithm-sandbox/D-CN-2）。三把公钥均取自 `GET /api/v1/attestation/trust-anchor` |
| `CONNECTOR_PLATFORM_NODE_PUBKEY` | connector | 是 | 否 | — | **平台节点密钥**公钥，验下发任务签名（含执行凭证/吊销名单/合约副署）。未配置则拒绝全部下发任务（fail-closed）。用 CA 根钥签出的对象一律拒绝 |
| `CONNECTOR_REGISTRY_PUBKEY` | connector | 是 | 否 | — | **注册中心密钥**公钥，验算子清单、算法模块签名与**脱敏规格**签名（即 P-CTL-6 的「专用算法签名密钥」，已与 CA 根钥分离）。未配置则拒绝一切沙箱执行与全部脱敏规格（fail-closed，`agent` 模式无法执行） |
| `PLATFORM_KEK` | api | 是 | 是 | — | 平台三把私钥（CA 根钥 / 平台节点密钥 / 注册中心密钥）的 **SM4 密钥加密密钥**（D-MDOP-3）。三把私钥以 `enc:v1:<iv>:<cipher>` 密文落库，本键是唯一解密来源：**生产环境未配置则平台拒绝启动**；开发环境回落固定 KEK 并显式告警。非 32 hex 的口令按 SM3 派生（前 32 hex = 16 字节）。轮换须同时重签三钥并按用途重新分发公钥 |
| `SM2_LEGACY_CUTOFF` | connector · api | 否 | 否 | `2026-09-24T00:00:00Z` | 离线核验器 `scripts/verify-endorsement.mjs` 接受**旧格式签名**的截止时间（切换点）。早于该时间的链上记录才允许旧格式（不做 Z_A、原始 r‖s）；切换后的记录只认国标格式，否则判定失败（防降级） |
| `CONNECTOR_SANDBOX_TIMEOUT_MS` | connector | 否 | 否 | `10000` | Wasm 算法模块执行时限，超时 terminate worker 并判任务失败 |
| `CONNECTOR_SANDBOX_MAX_MEMORY_MB` | connector | 否 | 否 | `64` | 沙箱内存上限（模块只导入宿主提供的这块内存），所需内存超限在调用前拒绝 |
| `RWS_ENDORSEMENT_REQUIRED` | api | 否 | 否 | `false` | **迁移期开关**（on-chain-provider-endorsement/D-RWS-5）：缺省渐进——连接器不带结果级背书只记告警、任务不破；两院连接器升级后置 `true` 切 fail-closed（无/错背书即拒该院贡献）。注意：**有背书任何时候都必须验过**，本开关只管「缺背书」是否放行 |
| `MODULE_LOCAL_BUILD_ALLOWED` | api | 否 | 否 | `false` | 允许控制面**自行编译**第三方模块源码（third-party-module-admission）。缺省 **false** 且生产必须保持 false：`cargo build` 会执行第三方 `build.rs` / proc-macro，是闸 1/闸 3 都不覆盖的编译期执行点，不能放在持有 CA 私钥、对外提供 HTTP 的控制面容器里（挂 docker.sock 去"隔离"更糟 —— 等同宿主 root）。生产路径：独立构建环境跑 `admit-cli.mjs` → `POST /module-admission/submissions/:id/attest-build` 交 ≥2 份产物，控制面自算 SM3、自比对、自过闸 1。仅本地 demo/e2e 可置 true |
| `WASM_ALGORITHMS_ROOT` | api | 否 | 否 | `packages/wasm-algorithms` | 第三方模块准入的**构建执行体**所在包根（third-party-module-admission 闸 2）：控制面触发构建时另起进程跑 `scripts/admit-cli.mjs`（锁定工具链、断网 hermetic、双构建器对拍 SM3）。与 `WASM_ALGORITHMS_DIR`（产物分发目录）不同：前者是**源码构建**入口，后者是**产物装载**目录 |
| `CODEX_PYTHON` | build script | 否 | 否 | `python3` | 生成注册研究报告 DOCX 时使用的 Python 可执行文件；容器/CI 可显式指向 bundled runtime |
| `WASM_ALGORITHMS_DIR` | api | 否 | 否 | `packages/wasm-algorithms/build` | 算法模块产物目录（清单 + .wasm），API 启动时装载为模块注册表；缺省按仓内布局定位 |
| `SF_ROUND_TIMEOUT_MS` | api | 否 | 否 | `120000` | 联邦训练单院单轮等待上限；超时的医院踢出本轮（下一轮仍可参与） |
| `XIAN_APP_KEY` | api | 否 | 是 | 空 | 西安节点能力中心分配的三方应用访问标识（PDF §5.2），空则开放接口返回 SYSTEM_ERROR |
| `XIAN_LOGIN_TICKET_TTL_MS` | api | 否 | 否 | `60000` | 免登一次性 ticket 有效期（毫秒），PDF §8 要求登录 URL 短时有效 |
| `XIAN_SM2_PRIVATE_KEY_PKCS8_B64` | api | 否 | 是 | 空 | 我方 SM2 私钥（PKCS#8 DER Base64），解密能力中心下发的敏感字段 |
| `XIAN_TENANT_ROLE_MAP` | api | 否 | 否 | 空 | 西安 tenantId → participantRole 映射 JSON；未命中默认 `consumer` |
| `XIAN_TIMESTAMP_TZ_OFFSET` | api | 否 | 否 | `+08:00` | X-Timestamp 解析时区（西安节点为北京时间） |
| `XIAN_TIMESTAMP_WINDOW_MS` | api | 否 | 否 | `300000` | X-Timestamp / X-Nonce 防重放时间窗（毫秒），PDF §5.2 建议 5 分钟 |
| `XIAN_WEB_BASE_URL` | api | 否 | 否 | `http://localhost:5020` | 免登 loginUrl 的 web 基地址（含协议，不含尾部斜杠） |
| `CONTROL_PLANE_DB_URL` | api | 否 | 是 | `postgres://…/medtrust_controlplane` | 控制面 PostgreSQL 库 |
| `CONTROL_PLANE_TIMEOUT_MS` | connector | 否 | 否 | `15000` | 调控制面超时 |
| `CONTROL_PLANE_URL` | connector | 否 | 否 | `https://medtrust-api.fly.dev/api/v1` | 控制面地址 |
| `DATABASE_URL` | database | 否 | 是 | `postgres://…/medtrust_api` | 业务主库连接 |
| `DB_SYNCHRONIZE` | api · connector | 否 | 否 | `false` | 仅首次 bootstrap/隔离测试允许 `true`；生产稳态必须关闭并保留 schema 迁移 |
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
| `INSTANCE_BRAND_LOGO` | api | 否 | 否 | 空 | 实例品牌 logo 的对象存储 key（开源后由部署者设置）；**禁外链** |
| `INSTANCE_BRAND_PRIMARY` | api | 否 | 否 | 空 | 实例品牌主色（`#rrggbb`，须过与底色的对比度）；空则用平台默认 |
| `INSTANCE_BRAND_TITLE` | api | 否 | 否 | 空 | 实例品牌系统标题（如「某省电力可信数据空间」）；空则回落平台默认 |
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
| `NEXT_PUBLIC_CHAT_AGENT_URL` | web | 否 | 否 | `http://localhost:5032/api/v1` | 对话式任务配置 Agent（apps/chat-agent）基址（构建期注入）；线上由 nginx 就近转到 5032 |
| `NEXT_PUBLIC_BASE_PATH` | web | 否 | 否 | 空 | Next.js 部署子路径（构建期注入）；空表示站点在根路径。隔离测试可设为 `/test`，所有页面与静态资源随该前缀发布 |
| `NEXT_PUBLIC_CONNECTOR_DATA_PATH` | web | 否 | 否 | `/data/synthea/ingested` | 前端展示用数据路径 |
| `NEXT_PUBLIC_ENABLE_DEMO_ACCOUNTS` | web | 否 | 否 | 空 | 是否展示演示账号快速填充（P0-1） |
| `NEXT_PUBLIC_WS_URL` | web | 否 | 否 | `ws://localhost:5021` | 前端 WS 基址（构建期注入）；留空且 API 为同源相对路径时跟随页面同源（`/ws` 由 nginx 转 API） |
| `NODE_ENV` | api · database · chat-agent | 否 | 否 | 非 `production` | 运行模式 |
| `PORT` | api · chat-agent | 否 | 否 | `5021`（api）/ `5032`（chat-agent） | API / 对话式任务配置 Agent 监听端口 |
| `POWER_MDOP_DEMO_ACL` | api | 否 | 否 | 关（比较 `true`） | 电力 MDOP 演示 ACL 播种开关；仅与 `deploy/power-demo` 合成数据配套，生产默认关闭，授权应由提供方/运营逐产品授予 |
| `POWER_MDOP_DEMO_SEED` | api | 否 | 否 | 关（比较 `true`） | 电力 MDOP 演示产品/用户/协作播种开关；仅用于 `deploy/power-demo` 演示，避免把测试数据带进普通电力空间 |
| `MEDTRUST_API_URL` | chat-agent | 否 | 否 | `http://localhost:5021` | 控制面 API 基址 |
| `MEDTRUST_API_PREFIX` | chat-agent | 否 | 否 | `/api/v1` | 控制面 API 路径前缀 |
| `ANTHROPIC_API_KEY` | chat-agent | 否 | 是 | 空 | Anthropic 供应商 key（`LLM_PROVIDER=anthropic` 时使用） |
| `DEEPSEEK_API_KEY` | chat-agent | 否 | 是 | 空 | DeepSeek 供应商 key（OpenAI 兼容协议）。**当前部署的供应商**（D-AI-4）；留空即退化为确定性 rule-based 客户端（问题文本不出域，D-AI-3） |
| `DEEPSEEK_BASE_URL` | chat-agent | 否 | 否 | `https://api.deepseek.com` | OpenAI 兼容基址（不含 `/chat/completions`）；指向自建网关时改这里 |
| `DEEPSEEK_MODEL` | chat-agent | 否 | 否 | `deepseek-flash` | DeepSeek 模型名 |
| `LLM_PROVIDER` | chat-agent | 否 | 否 | 按 key 推断 | `deepseek` / `anthropic` / `rule-based`。显式指定却缺对应 key 时退回 rule-based（`/health/ready` 的 `llm` 字段如实显示） |
| `CHAT_AGENT_SERVICE_TOKEN` | chat-agent | 否 | 是 | 空 | agent 自有凭证（AGENT.md R2）：仅用于目录等元数据读取，不复用调用者 token；留空读公开目录端点 |
| `CHAT_AGENT_DB` | chat-agent | 否 | 否 | `memory` | 会话存储驱动：`memory`（test/keyless fallback）\| `postgres`（持久化） |
| `CHAT_AGENT_DATABASE_URL` | chat-agent | 否 | 是 | 空 | 会话 PostgreSQL URL（`CHAT_AGENT_DB=postgres` 时必填） |
| `CHAT_MAX_MESSAGE_CHARS` | chat-agent | 否 | 否 | `4000` | 单条用户消息字符上限（超出 413） |
| `RATE_LIMIT_PER_USER_PER_MIN` | chat-agent | 否 | 否 | `30` | 每用户每分钟请求上限；`0` 关闭该维度（多实例部署下为**每实例**限流） |
| `RATE_LIMIT_PER_IP_PER_MIN` | chat-agent | 否 | 否 | `120` | 每 IP 每分钟请求上限；`0` 关闭该维度 |
| `METRICS_ENABLED` | chat-agent | 否 | 否 | `true` | 是否暴露 `/api/v1/metrics`（Prometheus 文本格式） |
| `SWAGGER_ENABLED` | chat-agent | 否 | 否 | `true` | 是否挂载 `/api/docs`（Swagger UI）与 `/api/docs-json`（OpenAPI） |
| `REDIS_URL` | chat-agent | 否 | 是 | 空 | Redis 连接串。**空 = 不启用**（目录缓存关闭、限流退化为每实例）；配置了却连不上会**拒绝启动** |
| `CACHE_DIRECTORY_TTL_SECONDS` | chat-agent | 否 | 否 | `300` | 目录（参与方/数据产品元数据）缓存 TTL |
| `REDIS_KEY_PREFIX` | chat-agent | 否 | 否 | `medtrust:chat-agent` | Redis 键前缀（同库多环境共存时避免撞键） |
| `OTEL_ENABLED` | chat-agent | 否 | 否 | `false` | 是否启用 OpenTelemetry 追踪。**关闭时不加载 SDK**（零开销）；开启后需可达的 collector |
| `OTEL_SERVICE_NAME` | chat-agent | 否 | 否 | `medtrust-chat-agent` | trace 里的服务名 |
| `OTEL_EXPORTER` | chat-agent | 否 | 否 | `otlp` | `otlp`（生产，指向 collector）或 `console`（本地肉眼验证） |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | chat-agent | 否 | 否 | 空 | OTLP/HTTP 端点；空则用 SDK 缺省（`localhost:4318`） |
| `LOG_LEVEL` | chat-agent | 否 | 否 | `info` | 日志级别（debug / info / warn / error） |
| `LOG_FORMAT` | chat-agent | 否 | 否 | `json` | 日志格式：`json`（生产）/ `pretty`（本地） |
| `LLM_MODEL` | chat-agent | 否 | 否 | `claude-3-5-sonnet-20241022` | Anthropic 模型名（`LLM_PROVIDER=anthropic` 时使用） |
| `LLM_MAX_TOKENS` | chat-agent | 否 | 否 | `4096` | LLM 单次最大输出 token |
| `SESSION_TTL_HOURS` | chat-agent | 否 | 否 | `24` | 会话过期时长（小时） |
| `AGENT_CONTEXT_MAX_MESSAGES` | chat-agent | 否 | 否 | `20` | 送入模型的最近历史条数（滑动窗口） |
| `DEFAULT_CONTRACTS` | chat-agent | 否 | 否 | 空 | 提交作业时默认绑定的合约 id（逗号分隔） |
| `DEFAULT_MIN_CELL` | chat-agent | 否 | 否 | `5` | 默认最小单元格阈值 |
| `DEFAULT_WINDOW_DAYS` | chat-agent | 否 | 否 | `90` | 提交作业默认有效期（天） |
| `CORS_ORIGIN` | chat-agent | 否 | 否 | `http://localhost:5020` | 允许的前端 Origin（逗号分隔） |
| `REFRESH_EXPIRES_DAYS` | api | 是 | 否 | — | 刷新令牌有效期（天） |
| `RWS_STALE_MS` | api | 否 | 否 | `300000` | RWS 任务过期阈值 |
| `SEED_DEMO_USERS` | api | 否 | 否 | 非 production 默认 `true` | 是否播种演示账号（P0-1） |
| `SILKROAD_NODE_ENDPOINT` | api | 否 | 是 | 空 | 丝路数港区域节点接口基址（P2-2；生产未配置则互认能力 fail-closed） |
| `SILKROAD_NODE_ID` | api | 否 | 否 | `silk-road` | 丝路数港节点标识（P2-2） |
| `SMS_GATEWAY_URL` | api | 否 | 是 | 空 | 短信网关连接串（P1-2 手机快捷登录；生产未配置则 fail-closed） |
| `SMTP_URL` | api | 否 | 是 | 空 | 邮件服务连接串（P0-6 忘记密码；生产未配置则 fail-closed） |
| `SPACE_ID` | api | 否 | 否 | `sh-med` | 数据空间标识，进 CA 证书主体；**已弃用**，改用请求级空间上下文（D-SPD-2），仅作过渡兜底 |
| `SPACE_PACKS` | api · connector | 否 | 否 | `med` | **部署白名单**：本部署被授权运行的能力包（逗号分隔）；MUST NOT 决定单个空间的启用集（D-SPD-10） |
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
| `BASE` | 否 | `http://localhost:5021/api/v1` | `scripts/rwd-demo/prepare.mjs` 使用的控制面地址 |
| `CDM_DRILL_DATABASE_URL` | 否 | — | 接入手册干净环境演练库的管理员连接串，由 `sh apps/connector/scripts/omop-onboarding-drill.sh` 起库并注入（`127.0.0.1:5028`，演练完即删，**非生产凭证**）；未设置则跳过演练用例 |
| `CDM_TEST_DATABASE_URL` | 否 | — | 连接器真实 PostgreSQL 用例（接入校验 / 投影下推 / 覆盖统计 / results 清理）的测试库管理员连接串；`sh apps/connector/scripts/omop-test-db.sh` 起库后为 `postgres://postgres:admin@127.0.0.1:5025/omop`（**非生产凭证**）；未设置则跳过这些用例 |
| `CONSUMER_EMAIL` | 否 | `research@meddata-inst.edu.cn` | E2E 演示消费方账号 |
| `CONSUMER_PASSWORD` | 否 | `demo123456` | E2E 演示口令（**非生产凭证**） |
| `CONTRACT_DEMOHOSPA` | 否 | 种子合约串 | E2E 用示范甲侧合约 ID |
| `CONTRACT_DEMOHOSPB` | 否 | 种子合约串 | E2E 用示范乙侧合约 ID |
| `LADDER_FULL` | 否 | 开（比较 `0`） | E2E 阶梯是否跑全量 |
| `NCBI_API_KEY` | 否 | — | PubMed AMR 文献抓取 API key（`scripts/amr/fetch_pubmed.py`，提升限流至 10 req/s） |
| `NCBI_EMAIL` | 否 | — | NCBI eutils 联系邮箱（同上） |
| `OPENCLAW_WEBHOOK_URL` | 否 | `http://localhost:8080/webhook/claude` | 本地通知钩子 |
| `PHARMA_SM2_PRIVATE_KEY` | 否 | 演示密钥表 | E2E 用药企 SM2 私钥（**非生产凭证**） |
| `POLL_INTERVAL_MS` | 否 | `5000` | E2E 轮询间隔 |
| `POLL_MAX` | 否 | `18` | E2E 轮询上限次数 |
| `DEMO_PASSWORD` | 否 | `demo123456` | RWD 演示脚本的账号口令（**非生产凭证**） |
| `HOSPITAL_A_ACCOUNT` | 否 | `admin@demohospa-hospital.com` | RWD 示例甲医院账号 |
| `HOSPITAL_B_ACCOUNT` | 否 | `admin@rjh.com.cn` | RWD 示例乙医院账号 |
| `RESEARCH_ACCOUNT` | 否 | `research@meddata-inst.edu.cn` | RWD 演示使用方账号 |
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
| 4 | 生产持久化统一 PostgreSQL | **2026-10-19 已解决**：API 控制面、chat-agent 会话与 A/B/C 连接器均使用独立 PostgreSQL 库；生产 `DB_SYNCHRONIZE=false`，schema 由 migration 管理。 |
| 5 | 密钥仍可由环境变量直接注入 | `JWT_SECRET` / `AWS_*` / `FLOWER_*` 等 `secret=是` 的键当前从 env 读取，未强制走 Vault。`TRUST.md` 的密钥控制点只覆盖 Vault 路径那条。 |
| 7 | 院内节点运行加固（ali29） | 2026-09-18 已应用 `deploy/ali29/compose.hardening.yaml`：4 个院内容器非 root、只读根、`cap_drop ALL`、`no-new-privileges`、内存/CPU/进程数上限、不发布主机端口、每院独立 internal 网络（仅通本院节点与 api）。2026-10-19 起控制面与连接器状态已迁 PostgreSQL，不再挂旧 SQLite 卷。**余项**：主机对 80 以外端口无防火墙，外网隔离只靠云安全组。 |
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
| 3 | 主机 | 启用 CSV / TDX / SEV-SNP 之一；厂商证明服务可达，或证明凭据可离线核验（D-TEE-3 共同前置） | **云上 TDX 已实测**（2026-10-14；第 8 代企业级 ECS `g8i`；证据 `openspec/changes/tdx-attestation-pilot/evidence/rerun-20261014/`）。CSV 分支仍为 `[需申请]` |
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
5. 各院：连接器开 C2 相关配置（`CONNECTOR_MDOP_KMS_REF` / `CONNECTOR_MDOP_KMS_PUBKEY` / `CONNECTOR_MDOP_KMS_DEPOSIT_URL`，已登记进 §2），
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
- **生产禁例运维事实（T3，2026-09-27）**：医院连接器一旦设 `NODE_ENV=production`，在硬件 `TeeEnclave` 接上之前会直接起不来——`SoftwareSealedCompute` 构造即抛错（故意 fail-closed，防静默用软件实现充当 C2）。当前 Fly 演示镜像刻意 `NODE_ENV=development`（`fly-services/connector/fly.toml`），不受影响。本条不改变 D9 的如实标注口径（院内仍标 `software`），也不表示「生产可以继续用软件实现当 C2」。

---

## 4.4 自托管推理机 LLMA（结果解读，2026-10-03 上线）

> 依据：DECISIONS D-AI-2、AGENT AGT-04、FLOW-AI-04。成立条件三条（平台自运维 / 只监听回环 /
> 不回落外部供应商）任何一条被破坏，都要退回 D-AI-1 口径处理。

| 项 | 值 |
|---|---|
| 机器 | 阿里云华北2，域 A 私网 `172.21.6.203`，Xeon 6 6982P-C（AMX），2 vCPU / 8G，Ubuntu 24.04；**非 TEE** |
| 推理服务 | OpenVINO Model Server 2026.4.0（`/opt/ovms`），systemd `ovms.service`，**只监听 `127.0.0.1:8000`** |
| 模型 | `OpenVINO/Qwen3-1.7B-int4-ov`（ModelScope 取得，`/opt/models`），服务名 `qwen3-1.7b` |
| 控制面访问 | ali29 上 systemd `llma-tunnel.service`：`ssh -L 172.17.0.1:18000:127.0.0.1:8000`，api 容器访问 `http://172.17.0.1:18000/v3` |
| 隧道密钥 | ali29 `/root/.ssh/llma_tunnel`；LLMA 侧 `authorized_keys` 限 `restrict,port-forwarding,permitopen="127.0.0.1:8000",command="/bin/false"`（只能转发这一个端口，拿不到 shell） |
| 主机密钥 | ali29 `/root/.ssh/known_hosts_llma`（`HostKeyAlias=llma`，换公网 IP 不用重钉） |

api 侧环境变量（`apps/api/.env`，不在 git）：

```
RESULT_INTERPRETER_LLM_BASE_URL=http://172.17.0.1:18000/v3
RESULT_INTERPRETER_LLM_MODEL=qwen3-1.7b
RESULT_INTERPRETER_LLM_VENDOR=self-hosted-openvino
RESULT_INTERPRETER_LLM_EXTRA_BODY={"chat_template_kwargs":{"enable_thinking":false}}
```

**LLMA 换公网 IP 后**（按量实例停机即换）：改 ali29 `/etc/llma-tunnel.env` 的 `LLMA_HOST`，
`systemctl restart llma-tunnel`。未配置或隧道断开时解读接口返回 503，不影响其他功能。

**待收口（需控制台或 ECS 权限）**：LLMA 安全组入方向只留 22 且限 ali29 与运维来源；
域 A ↔ 域 B 对等连接两侧安全组从 ALL 收到实际端口。

**回滚**：删掉 api 的四个 `RESULT_INTERPRETER_LLM_*` 变量即关闭该能力（接口 503，页面面板报错不影响结果展示）；
ali29 `systemctl disable --now llma-tunnel`。

## 4.5 TDX 试点的实际部署（2026-10-03，合成数据）

> 这是 §4.3「待上线清单」在**云上 TDX 试点**里实际落下来的形态，不是生产部署。
> 证据：`openspec/changes/tdx-attestation-pilot/evidence/RECORD.md` §3.7–§3.9。

| 组件 | 位置 | 运行方式 | 配置 |
|---|---|---|---|
| 可信空间节点 `tee-node-a` | teeA（域 A，`172.21.6.201`，g8i TDX） | systemd `tee-node`：`node /opt/medtrust/bin/tee-node.js serve`（单文件 bundle + 权限 0700/0600 的 `node-state.json`） | `/etc/medtrust/tee-node.env`；模块库 `/opt/medtrust/modules/<sm3hex>.wasm`；参与方公钥表 `/etc/medtrust/participant-keys.json` |
| TDX sidecar | teeA、teeB | `/usr/local/bin/tdx-sidecar`（`apps/connector/tools/tdx-sidecar/build.sh` 在机器上构建） | — |
| 校验方 + 试点密钥保管 | teeB（域 B，`10.10.0.10:5024`） | systemd `tee-verifier`：`/attest` `/keys` `/release` | `/etc/medtrust/tee-verifier.env`；节点 / 持有方公钥表 `/etc/medtrust/{node-keys,holder-keys}.json` |
| 密钥托付通道 | ali29 | systemd `kms-tunnel`：三个隔离网络的网关 `172.24.0.1` / `172.25.0.1` / `172.27.0.1`（`:15024`）→ teeA → teeB:5024 | `/etc/kms-tunnel.env`（`HOSP_A_GW` / `HOSP_B_GW` / `HOSP_C_GW`）；专用密钥在 teeA 侧限 `permitopen="10.10.0.10:5024"` |
| 两院连接器 | ali29 `rws-worker-a/b` | 镜像 `rel-20261003` | `CONNECTOR_MDOP_KMS_REF` / `_KMS_PUBKEY` / `_KMS_DEPOSIT_URL` / `_WATERMARK` |
| 疾控连接器（演示，疫苗 SCRI） | ali29 `rws-worker-c`，网络 `medtrust_hosp_c`（172.27.0.0/16） | 镜像 `medtrust-rws-worker-c:local`（数据 `data/demo/aefi/cdc`；示范乙侧 SCRI 事件数据在 worker-b 的 `/data/aefi`） | 同上四项；SM2 私钥只用卷里的密钥文件（**不要**从 worker-b 复制内联 `CONNECTOR_SM2_PRIVATE_KEY`） |
| 平台 | ali29 `api` | 镜像 `rel-20261003h` | `MDOP_KMS_PUBKEY` / `MDOP_ATTESTATION_VERIFIERS`（含校验方 id 与 KMS ref）/ `MDOP_ATTESTATION_MEASUREMENTS` |

运维事实：

- **三处 KMS 标识必须相等**：`TEE_VERIFIER_KMS_REF` = `TEE_NODE_KMS_REF` = 各院 `CONNECTOR_MDOP_KMS_REF`（否则节点会拒掉「不是信封指定保管方」的凭据）。
- **校验方重启即丢已托付的密钥**（试点形态，密钥只在内存）；在途作业会在释放时被拒，需重提。
- **teeA 换公网 IP 后**：改 ali29 `/etc/kms-tunnel.env` 的 `TEEA_HOST` 并重启 `kms-tunnel`。
- **重建 api 时**合约副署消息在送达前不会再被清理（发件箱保留窗口 10 分钟）；节点在平台重启期间会退避重试，不再退出。
- **新增隔离网络后必须重跑 `/opt/medtrust/harden-iptables.sh`**：DOCKER-USER 白名单只覆盖执行时已存在的网桥；子网避开 172.26（已被占用）。
- teeA 节点 bundle 回滚点 `/opt/medtrust/bin/tee-node.js.prev-purge`（销毁回执签名修复前）；api 回滚点 `medtrust-api:rel-20261003e`（SCRI 解读回查与见证转发修复前）。
- 回滚：两院去掉 `CONNECTOR_MDOP_KMS_*` 并回 `medtrust-rws-worker-{a,b}:pre-20261003`；平台回 `medtrust-api:pre-20261003`；
  停 `tee-node` / `tee-verifier` / `kms-tunnel`。合约若要回到无证明策略的条款，需重新要约（各院重签）。

## 4.6 ali29 隔离测试栈（2026-10-17）

测试入口：`https://api.szchada.top/test/`（同机备用 `https://web.szchada.top/test/`）。
根路径 `https://api.szchada.top/api/v1/*` 与 `https://web.szchada.top/` 仍指向原生产容器。

| 资源 | 测试值 | 生产值（不变） |
|---|---|---|
| Web / API / chat-agent 容器 | `medtrust-test-web` / `medtrust-test-api` / `medtrust-test-chat-agent` | `medtrust-web` / `medtrust-api` / `medtrust-chat-agent` |
| 主机端口 | `172.17.0.1:5120` / `5121` / `5132` | `5020` / `5021` / `5032` |
| PostgreSQL 库 | `medtrust_api_test`（从 `medtrust_api` 一致性 dump 克隆；测试 API 经 `172.17.0.1:55432` 访问） | `medtrust_api` |
| 控制面 PostgreSQL | `medtrust_controlplane_test` | `medtrust_controlplane` |
| Web 镜像 | `medtrust-web:rel-20261017-test`（basePath `/test`） | `medtrust-web:local` |

启停：

```bash
cd /opt/medtrust
docker compose -f compose.test.yaml up -d
docker compose -f compose.test.yaml down
```

Web 测试镜像的构建参数：

```bash
docker build -f fly-services/web/Dockerfile \
  --build-arg NEXT_PUBLIC_BASE_PATH=/test \
  --build-arg NEXT_PUBLIC_API_URL=/test/api/v1 \
  --build-arg NEXT_PUBLIC_WS_URL=wss://api.szchada.top/test \
  --build-arg NEXT_PUBLIC_CHAT_AGENT_URL=/test/chat-agent/api/v1 \
  -t medtrust-web:rel-20261017-test .
```

回滚只撤子路径与测试栈，不影响生产绑定：恢复
`/opt/nginx/nginx.conf.before-test-*` 和
`/opt/sites/szchada.com/nginx/site.conf.before-test-*` 后分别 reload nginx，再执行
`docker compose -f /opt/medtrust/compose.test.yaml down`。生产库 `medtrust_api` 与
生产控制面库不由测试栈写入。

**隔离边界（2026-10-17 实测）**

- 已隔离：web、api、chat-agent 容器；主机端口；`medtrust_api_test`；`medtrust_controlplane_test`；`medtrust_chat_agent_test`。
- 未隔离：连接器 `rws-worker-a/b/c`、TDX 节点、KMS、chain、mpc、vault。测试 API 提交的
  连接器型作业不会自动由测试栈执行；连接器仍按原配置轮询生产 API。要做完整端到端回归，须再复制
  连接器和数据卷，并把 `CONTROL_PLANE_URL` 改到测试 API。
- PostgreSQL 用 `pg_dump` / `pg_restore` 克隆，禁止直接复制数据库目录；测试 API 以
  `NODE_ENV=development` 启动时会补种演示账号，因此用户数可能与克隆源不同，这不代表写穿生产。
- 测试 API **不得**接入 `medtrust_default`：Compose 会在该网络自动注册服务别名
  `api`，与生产 API 冲突，导致 chat-agent 随机连到测试库。测试 API 只使用自己的网络，
  PostgreSQL 经宿主端口 `172.17.0.1:55432` 访问；测试 chat-agent 经
  `http://172.17.0.1:5121` 访问测试 API。新增 Docker 网络仍会被 ali29 的
  `DOCKER-USER` 策略拦截，不要误判为 API 未启动。
- `medtrust-nginx` 和 `szchada-web` 的单文件 bind mount 按 inode 工作。用 `install` 或
  `mv` 替换宿主机文件后，容器仍可能读到旧 inode；应使用 `cp` 原地覆盖并 reload，
  或明确重启容器后再 `nginx -t`。本次 `/test` 首次 404 即由此产生。
- 验收至少覆盖：登录页、`/_next` 静态资源、登录 POST、`/notifications`、chat-agent
  `external-control` 配置卡，以及旧根路径仍返回原生产健康响应。

### 4.6.1 web.szchada.top 的 443 回源 vhost（2026-10-17 修复）

**症状**：`https://web.szchada.top` 对公网返回 Cloudflare **520**（`error code: 520`），
而源站 80 端口用 `Host: web.szchada.top` 直测是 200。

**根因**：Cloudflare 以 **HTTPS(443)** 回源，而 `szchada-web` 容器（TLS 终结层）只有
`www.szchada.com` / `api.szchada.top` / `cloud.szchada.com` 的 443 server 块，
没有 web 主机的；请求落到 default_server 的 `return 444`（空响应）→ CF 判为 520。
（源站 443 访问日志可见 CF 边缘 IP 对 `/` 返回 444，条数与我方探测一致。）

**修复**：在 `/opt/sites/szchada.com/nginx/site.conf` 追加（备份
`site.conf.bak-web443-20261017`）：

```nginx
map $http_x_service $medtrust_service { default $http_x_service; "" web; }
map $http_upgrade $medtrust_conn { default upgrade; "" ""; }

server {
    listen 443 ssl;
    server_name web.szchada.top origin.szchada.top;
    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    location / {
        proxy_pass http://172.17.0.1:80;         # medtrust-nginx 的 web vhost
        proxy_http_version 1.1;
        proxy_set_header Host web.szchada.top;
        proxy_set_header X-Service $medtrust_service;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $medtrust_conn;
        proxy_read_timeout 3600s;
    }
}
```

```bash
docker exec szchada-web nginx -t && docker exec szchada-web nginx -s reload
```

> 该文件在容器内是**单文件 bind mount**：必须原地写（`cp`/覆盖，保持 inode），
> `docker cp` 会报 `device or resource busy`；用 `mv` 换文件则容器仍读旧 inode。
> `Connection` 不能恒设 `"upgrade"`：无 Upgrade 头的普通响应会挂住，表现为
> `/_next/static` 分块取不完（实测 27KB 分块 30s 未完成）。

**回滚**：`cp -p /opt/sites/szchada.com/nginx/site.conf.bak-web443-20261017 /opt/sites/szchada.com/nginx/site.conf`
后 reload；并确认 `curl -I https://web.szchada.top/` 回到 200（回滚后应为 520）。

**发布自检建议**：把「`https://web.szchada.top/` 返回 200 且 `/_next/static` 分块可取完」
纳入发布后外部探测——本次故障只在公网路径暴露，容器 `Up` 与源站 80 自测都是绿的。

**复发（2026-11-03）**：同一症状再现——CF 返回 **520**，源站 `:80` 直测 **200**，
源站 `:443` 可完成 TLS 握手但 HTTP 无响应（`szchada-web` 侧又回到了空响应）。
排查与修复已脚本化：

```bash
./scripts/recover-web.sh          # 分层探针：DNS / 边缘 / 源站 80 / 源站 443 + 容器与 nginx 只读检查
./scripts/recover-web.sh --fix    # 仅在 5020 不通时重启 web 容器；并重启 TLS 层 szchada-web
```

脚本第 ④ 节直接打印本节 §4.6.1 的 vhost 追加命令（含备份与 inode 注意事项）。
判据仍是那两条：边缘 200、且首页体积 > 20KB 不卡。

**复发第二次（2026-11-04，已完成修复）**：症状与前两次完全一致（CF 520、源站 `:80` 200、
源站 `:443` 空响应）。本次定位到**丢失时刻**而不是再次手补：

- `site.conf` 的 mtime 是 **2026-10-28 16:10**，同分钟还写入了 `site.final.conf` 与
  `site.transition.conf`；这三个文件是站点模板的产物，`web.szchada.top` 的 server 块不在模板里，
  于是**一次站点模板覆盖就把 medtrust 的 443 vhost 抹掉了**（10-05 抹掉 `cloud.szchada.com`、
  10-17 与 11-03 抹掉 `web.szchada.top` 是同一根因，不是 reload/inode 问题）。
- 修复：按本节追加 server 块（`cat >>` 原地写保 inode）。注意 `site.conf` **已有**
  `map $http_upgrade $medtrust_conn`（第 1 行），只需补 `map $http_x_service $medtrust_service`，
  否则 `nginx -t` 报 duplicate map。
- 结构性对策（未落地，属待办）：`web.szchada.top` 的 vhost 应单独成文件（如
  `conf.d/medtrust-web.conf`），不要与站点模板同文件；模板覆盖只能动模板自己的文件。
  在落地前，**每次官网 deploy-site 之后**都要跑一次 `./scripts/recover-web.sh` 复检。

## 4.7 Aliyun TEE / LLMA 停机重启手册（teeA / teeB）

> teeA、teeB、LLMA 都是**阿里云 cn-beijing 的独立 ECS**，不是 ali29 上的 Docker 容器。
> 从零采购、VPC、对等连接和 TDX 证据流程见
> [`openspec/changes/tdx-attestation-pilot/runbook-rebuild.md`](./openspec/changes/tdx-attestation-pilot/runbook-rebuild.md)；
> 本节只记录日常停开机最容易漏掉的依赖。

### 4.7.1 固定拓扑与控制面依赖

| 角色 | 实例 ID | 网络 | 固定私网地址 | 常驻服务 / 用途 |
|---|---|---|---|---|
| teeA | `i-2ze8qci4r5ec6trmywi0` | 域 A | `172.21.6.201` | `tee-node`；真实 TDX quote；也是到 teeB 的 SSH 跳板 |
| teeB | `i-2zegnqenh9yx2e0g2c8o` | 域 B | `10.10.0.10` | `tee-verifier`；`/attest`、`/keys`、`/release` |
| LLMA | `i-2ze08mpxq8bxty8exbuj` | 域 A | `172.21.6.203` | OpenVINO Model Server，`127.0.0.1:8000` |

ali29 上有两条 systemd 出站隧道：

- `kms-tunnel`：三个院内容器网关 `172.24.0.1:15024`、`172.25.0.1:15024`、
  `172.27.0.1:15024` → `teeA 公网:22` → `10.10.0.10:5024`。
- `llma-tunnel`：`172.17.0.1:18000` → `LLMA 公网:22` → `127.0.0.1:8000`。

停机会释放按量实例的公网 IP；私网 IP、磁盘、`authorized_keys` 和 systemd unit 保留。
因此每次开机都必须重新读取 teeA / LLMA 公网 IP；teeB 的公网 IP 变化不影响 `kms-tunnel`，
因为隧道始终经 teeA 访问 teeB 的固定私网 `10.10.0.10`。

### 4.7.2 阿里云控制台或 CLI 开机

控制台：ECS → 华北2（北京）→ 实例，按实例 ID 启动 teeA、teeB、LLMA。

CLI 使用有 `ecs:StartInstance` 权限的 RAM 用户。仓库不保存 AK；本机凭证文件为
`.secrets/aliyun.env`（gitignored），且必须显式传参，避免被本机 default profile 覆盖：

```bash
source .secrets/aliyun.env
AK="$ALIYUN_TEETESTER_AK"
SK="$ALIYUN_TEETESTER_SK"

aliyun sts GetCallerIdentity --access-key-id "$AK" --access-key-secret "$SK"

for id in i-2ze8qci4r5ec6trmywi0 i-2zegnqenh9yx2e0g2c8o i-2ze08mpxq8bxty8exbuj; do
  aliyun ecs StartInstance --access-key-id "$AK" --access-key-secret "$SK" \
    --RegionId cn-beijing --InstanceId "$id"
done
```

取公网 IP 时优先用 `DescribeInstanceAttribute`。实测 `carbon` 凭证允许该接口，但不允许
`DescribeInstances` 列表接口：

```bash
aliyun ecs DescribeInstanceAttribute --access-key-id "$AK" --access-key-secret "$SK" \
  --RegionId cn-beijing --InstanceId i-2ze8qci4r5ec6trmywi0
```

若控制台或本机 SSH 被安全组挡在 kex 阶段，不要继续更换私钥；用 ECS 云助手：

```bash
aliyun ecs RunCommand --access-key-id "$AK" --access-key-secret "$SK" \
  --RegionId cn-beijing --Type RunShellScript --ContentType PlainText \
  --InstanceId.1 i-2ze8qci4r5ec6trmywi0 \
  --CommandContent 'systemctl start tee-node && systemctl is-active tee-node'
aliyun ecs DescribeInvocationResults --access-key-id "$AK" --access-key-secret "$SK" \
  --RegionId cn-beijing --InvokeId <t-...>
```

### 4.7.3 开机后的必改项与启动顺序

1. **更新 teeA 公网 IP**（只改 ali29，不改 teeB 私网地址）：

   ```bash
   ssh ali29
   sed -i 's/^TEEA_HOST=.*/TEEA_HOST=<teeA 当前公网 IP>/' /etc/kms-tunnel.env
   systemctl restart kms-tunnel
   ```

2. **启动 teeB 校验方**。建议用云助手直接对 teeB 执行，避开跨域 SSH：

   ```bash
   systemctl start tee-verifier
   systemctl is-active tee-verifier
   curl -s -m 3 http://10.10.0.10:5024/attest
   ```

3. **启动 teeA 节点并刷新证明**：

   ```bash
   systemctl start tee-node
   systemctl is-active tee-node
   set -a; . /etc/medtrust/tee-node.env; set +a
   cd /opt/medtrust
   /opt/node/bin/node bin/tee-node.js advertise   # 期望 tee{kind:"tdx",min_tcb:"5.1.3"}
   /opt/node/bin/node bin/tee-node.js probe       # 期望 accepted=true, endorsed=true
   ```

   手工执行子命令前必须 `source` env；systemd 会读，普通 shell 不会。

4. **更新 LLMA IP**并重启推理隧道：

   ```bash
   ssh ali29
   sed -i 's/^LLMA_HOST=.*/LLMA_HOST=<LLMA 当前公网 IP>/' /etc/llma-tunnel.env
   systemctl restart llma-tunnel
   curl --noproxy '*' -sS http://172.17.0.1:18000/v3/models
   ```

5. **确认三处 KMS 标识相等**：
   `TEE_VERIFIER_KMS_REF` = `TEE_NODE_KMS_REF` = 各院
   `CONNECTOR_MDOP_KMS_REF`。试点现行值应为 `kms://verifier-domain-b`。

`known_hosts` 使用 `HostKeyAlias=teea` / `HostKeyAlias=llma`；IP 变化不需要删除主机密钥。

### 4.7.4 复活判据与常见故障

只看 `systemctl is-active kms-tunnel` 不够。真正判据是三条转发和 SSH 目标同时正确：

```bash
ssh ali29 'ss -lntp | grep 15024'
ssh ali29 'pgrep -af "ssh -N"'
ssh ali29 'journalctl -u kms-tunnel -n 30 --no-pager'
```

- 日志持续 `Connection timed out`，或 `pgrep` 中仍出现旧 teeA IP：`TEEA_HOST` 未更新，
  systemd 的 `Restart=always` 会一直重连但业务始终不可用。
- 平台节点长期离线：先检查 teeA 实例状态和 `TEEA_HOST`，再检查 `tee-node`；不要先改合约或证明策略。
- 证明 probe 失败：检查 `/dev/tdx_guest`、`tdx-sidecar`、Intel PCS 出站 443，以及校验方
  `tee-verifier` 是否已启动。
- **tee-verifier 重启会丢失内存中的已托付密钥**（试点形态，不是生产 KMS）；重启前的在途 C2
  作业需要重提。
- TDX 试点实例的可靠停开方式是阿里云 Stop/Start。按试点实测，不要依赖 TDVM 内直接
  `reboot`；需要重启时从控制台/CLI 停机再开机。
- `StopCharging` 只停计算费，系统盘仍计费；彻底停止费用须按 runbook §8.1 释放实例和网络。

## 4.8 Cloudflare / DNS 与子域名取舍（2026-10-17 核实）

当前 DNS：Cloudflare 控制面中 `web.szchada.top` 的源站记录为 A `120.55.53.86`，
并启用橙云代理；公网递归查询看到的是 Cloudflare 边缘地址（本次为
`104.21.64.35 / 172.67.175.231`），不要把边缘地址误记为源站地址。
`chain`、`vault`、`mpc` 也处于橙云代理形态；`api.szchada.top` 为灰云直连 ali29。
Cloudflare 回源侧使用 `origin.szchada.top`，`medtrust-nginx` 按 `X-Service` 把
web / api / mpc / chain 分流；仓库内没有 `szchada-proxy` Worker 的源码，
因此 Worker 路由只能在 Cloudflare 控制面审计和修改。

| 域名 | 当前用途 | 是否公开需要 | 建议 |
|---|---|---|---|
| `web.szchada.top` | 浏览器控制台；当前源站 A `120.55.53.86`，橙云 | 需要 | **保留橙云**。继续用 Cloudflare 的 TLS/WAF/DDoS 防护；改灰云需另做源站证书、WAF 和限流。 |
| `api.szchada.top` | 机器调用、连接器、测试直连 | 需要 | **保持灰云直连**。长轮询与跨域机器调用不应依赖 Cloudflare 100 秒限制；浏览器仍走 web 同源。 |
| `chain.szchada.top` | ChainMaker sidecar | 不需要 | **删除公网 DNS**。链只供 api 容器使用，不应把 raw chain 暴露到公网，也不应改成灰云。 |
| `mpc.szchada.top` | MP-SPDZ 网关 | 不需要 | **删除公网 DNS**。若外部合作方确需计算，走专用网关、mTLS/IP 白名单或专线，不直接暴露 MPC。 |
| `vault.szchada.top` | Vault | 不需要 | **立即删除公网 DNS**。当前 origin nginx 甚至没有 vault server block；Vault 绝不能因灰云而公开，只保留 Docker 私网/受限管理通道。 |

结论：**不要把这四个域名统一改成灰云。** 灰云只是拿掉 Cloudflare 代理，不等于隔离；
`chain/mpc/vault` 应删除公开入口，`web` 保留橙云，`api` 保持已有的灰云直连。

另外，当前 compose 把 Vault、MPC、Chain 映射为 `0.0.0.0` 主机端口，外网隔离依赖
DOCKER-USER/云安全组。生产收口应改为只绑 `172.17.0.1` 或应用私网，并让 nginx/api
在内部网络访问；`vault.szchada.top` 无论如何不应恢复。

执行 DNS/Worker 变更时必须三件一起核对：Cloudflare DNS 记录、`szchada-proxy` 的 Host
路由、origin nginx 的 `server_name` / `X-Service` 分流。只删其中一处会留下“域名解析但
回源 404/axx”或“DNS 已删、Worker 仍保留入口”的半状态。

## 4.9 部署测试踩坑速查

1. `localhost:5020/5021/5432` 是**运行这些进程的机器**的地址；ali29 上的服务应对
   `https://api.szchada.top/test/...`，不能在自己电脑上访问 localhost。
2. Cloudflare 的 `web.szchada.top` 可能偶发 SSL/长请求超时；测试稳定入口优先用灰云
   `api.szchada.top/test/`，但生产浏览器入口仍是 `web.szchada.top`。
3. 服务“容器 Up”不代表可用：还要验证 `nginx -t`、公网/本机 HTTP、登录、通知、chat-agent
   卡片和旧入口回归。
4. 数据隔离不是只换库名：控制面、业务主库、会话库与每个连接器库分别核对账号权限；
   PostgreSQL 用 dump/restore，迁移脚本只以只读方式读取历史 SQLite。
5. 测试栈没有连接器隔离时，不要用“作业进入 SUCCEEDED/PURGED”判断测试环境；它需要的执行面
   仍可能是生产连接器和 TDX/KMS。
6. Cloudflare、ali29 nginx、TLS 容器是三层配置；排障按 DNS → TLS vhost → origin nginx →
   Docker 端口逐层检查，避免直接改业务容器。
7. 阿里云按量实例停机后公网 IP 不是稳定标识；**实例 ID 和私网 IP才是稳定标识**。
   每次开机都重新读 IP、更新 ali29 隧道、看转发是否真正建立。

## 4.7 PostgreSQL-only 持久化切换（ali29，2026-10-19）

对应 openspec change `postgresql-only-persistence` 与决策 `D-DB-2`。生产 API、三个 RWS
连接器与 chat-agent 均不再打开 SQLite 文件。

| 边界 | PostgreSQL 数据库 | migration |
|---|---|---|
| API 控制面 | `medtrust_controlplane` | `PostgresControlPlaneInitial1750000000000` |
| 连接器 A/B/C | `medtrust_connector_a/b/c`（独立凭据） | `PostgresConnectorInitial1750000000000` |
| chat-agent 会话 | `medtrust_chat_agent` | `PostgresSessionInitial1750000000000` |
| 隔离测试 | `medtrust_controlplane_test` / `medtrust_chat_agent_test` | 同上 |

生产要求：

- `DB_SYNCHRONIZE=false`。生产 schema 只由显式 migration 管理。
- 每个连接器只拿到自己的数据库 URL；禁止共享控制面或其他连接器凭据。
- 迁移已有 SQLite 数据必须使用 `scripts/migrate-sqlite-to-postgres.mjs`，先 `--dry-run`，
  再执行并对拍行数、CA 公钥、合约哈希和签名；源 SQLite 保持只读且不删除。
- 回滚点：旧镜像 tag `pre-postgres-20261019`；SQLite/配置备份目录
  `/opt/medtrust/backup/postgresql-cutover-20261019/`。
- 当前切换镜像：API `postgres-20261019h`，连接器 A/B/C `postgres-20261019g`，
  chat-agent `postgres-20261019g`；web 镜像不随数据库切换变化。

2026-10-19 验收证据：

- 生产控制面 45 张实体表，26 份数字合约；连接器 A/B/C 各 13 张表；chat-agent 会话表由
  migration 建立，`/health/ready` 返回 `sessionStore=postgres`。
- 生产 API 与测试 API 均完成 28 张空间活动表回填；所有生产及测试容器 `.db` 文件句柄为 0。
- 新 MDOP 作业 `job-mvfnmtfh-b8314bec` 先到达 `SUCCEEDED`，随后按终态保留策略进入
  `PURGED`：两院数据源、L1.5、降密与平台合并全部完成；两院回执链各 3 条、均
  `valid=true`，控制面收齐两院各 4 条签名回执。

---

## 4.10 前端发布（ali29，2026-11-04，web + chat-agent `rel-20261104`）

> 对应 HEAD `a6da5d1`。**只换 web 与 chat-agent**：api 自 `notify-20261020d` 之后只有
> prettier 格式化与测试改动，无行为变化；而重建 api 会重跑启动播种（见 §4.2 与
> `scripts/recover-web.sh` 的告警），故本次不动 api / db / connector。

| 服务 | 镜像 | 来源 |
|---|---|---|
| web | `medtrust-web:rel-20261104` | `fly-services/web/Dockerfile`，构建上下文 `/opt/medtrust/build/rel-20261104` |
| chat-agent | `medtrust-chat-agent:rel-20261104` | `fly-services/chat-agent/Dockerfile`，同上 |
| api | `medtrust-api:notify-20261020d`（未变动） | 上一版 |

构建口径（在 ali29 本机 x86_64 上构建；源码用 `git archive HEAD <paths>` 打包上传，
**不要**带 `node_modules` / `data`）：

```bash
docker build -f fly-services/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=/api/v1 \
  --build-arg NEXT_PUBLIC_WS_URL= \
  --build-arg NEXT_PUBLIC_CHAT_AGENT_URL=/chat-agent/api/v1 \
  -t medtrust-web:rel-20261104 .
docker build -f fly-services/chat-agent/Dockerfile -t medtrust-chat-agent:rel-20261104 .
```

**`NEXT_PUBLIC_CHAT_AGENT_URL` 必须写 `/chat-agent/api/v1`**。上一版 web 镜像错写成 `/chat`，
前端实际请求 `/chat/chat/sessions`（浏览器侧基址与 `chat-api.ts` 里的 `/chat/...` 路径叠加），
nginx 没有该 location，用户看到的就是「AI 助手请求失败（HTTP 404）」。
判据：构建产物里该常量应为 `let u="/chat-agent/api/v1"`，且
`curl -s -o /dev/null -w '%{http_code}' https://web.szchada.top/chat-agent/api/v1/health` 为 200。
`NEXT_PUBLIC_WS_URL` 留空是**刻意**的：`endpoints.ts` 会从页面地址推导同源 `wss://`。

切换与回滚：

```bash
cd /opt/medtrust   # compose.yaml=web，compose.chat-agent.override.yaml=chat-agent（已备份 .bak-deploy-20261104）
docker compose -f compose.yaml -f compose.hardening.yaml -f compose.chat-agent.override.yaml \
  up -d --no-deps web chat-agent
# 回滚：把两个文件里的 tag 改回 notify-20261020b / notify-20261020h 后执行同一条 up -d --no-deps
```

发布后验收（2026-11-04 实测）：

| 项 | 结果 |
|---|---|
| `https://web.szchada.top/` | 200，69,111 B |
| `/login` | 200 |
| `/_next/static` 分块 | 200，27,128 B |
| `/chat-agent/api/v1/health`（同源） | 200 |
| `https://api.szchada.top/api/v1/health` | 200（api 未动） |
| `/notifications` | 404 —— **前端没有这个页面**，通知是铃铛 + 推送流，不是故障 |

**踩坑**：本次验收中 CF 边缘有 2/3 次 20–30 秒超时、只回半截 body；同一时刻源站 `:80`/`:443`
都是 0.1 秒内 68,880 B。**判据以源站为准，边缘超时先复测**，不要据此回滚镜像。

---

## 5. 忽略名单

> 不参与三方对拍的键。名单本身须非空可解析。

| 键 | 为什么忽略 |
|---|---|
| `STEAL` | 只作为**字符串字面量**出现在 `apps/connector/src/domain/**/*.spec.ts` 的夹具里——用例在验证语法校验器会拒绝用户算法里的 `process.env` 访问。不是本项目的读取点。 |
| `STEAL_KEY` | 同上。 |
| `TESSDATA_PREFIX` | `scripts/mask-demo-names.py` 为 tesseract 在**进程内**设置的变量（`os.environ[...] = ...`），不是本项目的配置键。 |
| `ECO_DECK` | `scripts/patch-ecosystem-deck.py` 的一次性输入路径（外部 deck 文件），非部署配置。 |
| `ECO_NO_WATERMARK` | 同上；一次性跳过水印的工具开关。 |
---

## 附录：格式契约（校验器解析规则）

1. **§2 ∪ §3 的键位集合 == 代码扫描面的读取点集合（双向相等）。** 任一方向缺失 = 红。
2. §5 忽略名单不参与对拍。
3. §1 中来源列标 `fly-services/**/*.toml` 的端口，须在该文件的 `internal_port` 中出现；标 `docker-compose` 的须在 `docker-compose.yml` 的 `ports` 中出现。标 `代码缺省` 的不对拍。
4. **扫描面**（显式声明，校验器与本文件必须一致）：
   - 部署面：`apps/api/src` · `apps/web/src` · `apps/web/next.config.ts`（构建期读取） · `apps/connector/src` · `apps/connector-ml` · `industries` · `apps/agent` · `apps/chat-agent/src` · `packages/database/src` · `packages/demo-scenario` · `packages/proto`
   - 测试面：`apps/api/scripts` · `scripts` · 以及部署面内的 `*.spec.ts` / `*.test.ts` / `__tests__/`
   - 排除：`node_modules` · `.next` · `dist` · `build` · `.turbo` · `coverage` · `.venv` · `__pycache__` · `output`
   - 排除目录 `video/` · `.claude/` · `fly-services/`：前两者是仓内旁支（视频生成、智能体工具），后者是基础设施模板，均不属应用配置面。
   - 读取点形态：`process.env.KEY` · `process.env['KEY']` · `configService.get('KEY')` · `os.environ[.get]('KEY')` · `getenv('KEY')`
   - **匹配 `process.env.KEY` 前先剥除字符串字面量**，否则 spec 夹具里的 `"process.env.STEAL"` 会被当成读取点（§5 即由此而来）。
5. **任一契约表解析为 0 行 = 格式契约破坏 = 红。**
6. §2/§3 ↔ 样例文件（`.env.example` · `.env.fly.example` · `apps/connector/.env.example`）**只报警告，不判红**：
   样例文件的键可能由仓外的 `fly secrets` 直接消费，工作区内无法判定其死活。
   判不准就判红会教会人"红是常态"，比没有检查更坏。当前差额记在 §4 第 1 条，**须随对齐进度收敛**。
