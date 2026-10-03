## Context

三台阿里云华北2 机器，分属两个 VPC（`tdx-attestation-pilot` RECORD §3.6；2026-10-03 00:02 CST 复核）：

| 机器 | 域 / 私网 IP | 规格 | TDX | 现状 |
|---|---|---|---|---|
| teeA | 域 A · 172.21.6.201 | g8i 4 vCPU / 16G（Sapphire Rapids） | 是 | go、`go-tdx-guest`、`xdattest`；无 node / docker |
| teeB | 域 B · 10.10.0.10 | 同上 | 是 | 同上 |
| LLMA | 域 A · 172.21.6.203 | Xeon 6 6982P-C 2 vCPU / 8G，AMX（tile/int8/bf16） | 否 | 空机；**绑了公网 IP** |

域 A = `172.16.0.0/12`，域 B = `10.10.0.0/16`，经对等连接 `pcc-k4kg47h5r5d2gkp0c6` 互通，两侧路由为整段互指。域 B 安全组对 `172.16.0.0/12` 放行 ALL；实测 teeB → LLMA 的 22 端口可达。

公网 IP 停机即换，不入文档；以私网 IP 为准。

已有底子：真实 quote 产出、跨域验签到 Intel 根、SM2 密钥释放（命令行工具层）。仓内 `TdxAttestationProvider` 仅有端口与单测，真机接线未做。唯一的 LLM 调用点是 `apps/api/src/secretflow-assistant/`（AGT-01，DeepSeek，`openai` SDK）。

受众是 Intel 生态团队，目标是联合方案背书；画面要求全链真跑。

## Goals / Non-Goals

**Goals:**
- 两个场景在三台机器上真实跑通，全程合成数据。
- 展示 Intel 兼容面：TDX quote V5 / DCAP + Intel PCS / 至强 AMX / OpenVINO；覆盖 4 代（g8i）与 6 代至强两种机型。
- 截图与视频的每个画面可追溯到真实运行证据。

**Non-Goals:**
- 机密推理（TDX 内跑模型）；GPU / Arc / Gaudi。
- 推理性能基准或对比结论（2 vCPU 机型不构成性能主张）。
- 生产 KMS（D-TEE-1）、真实患者数据（REG-08）。
- 改 `packages/mdop` 协议；改院内连接器 `attestationLevel`（恒 `software`）。

## Decisions

### S1 场景 1 不另立实现，直接依赖 `tdx-attestation-pilot`
场景 1 的全部工程量就是该变更的 2.4 / 3.x / 4.x。本变更只加两件事：角色落位（teeA = 证明方 + 计算节点，teeB = 校验方 / KMS 形状，控制面在本地或 ali29）与取证。
- 备选：在本变更里再写一套演示专用链路——否决，等于两套证明实现，且演示链路不构成 D-TEE-3 ② 证据。

### S2 推理栈用 OpenVINO Model Server，而非 vLLM + IPEX-LLM
OVMS 提供 OpenAI 兼容 `/v3/chat/completions`，单二进制/单容器，对 2 vCPU / 8G 友好，是 Intel 自家栈，背书叙事最直接。
- 备选 vLLM：CPU 后端重、小内存下启动风险高。
- 备选 llama.cpp / Ollama：最省事，但不是 Intel 栈，削弱演示目的。
- 代价：`external-claims.md` §1 / §2 两处「vLLM + IPEX-LLM」须改为 OpenVINO，并把推理机型写成实测的 Xeon 6 6982P-C（原 runbook 写 g9i，按实测 SKU 回填）。

### S3 模型取最小可用量化模型
首选 OpenVINO 预转换的 Qwen3-0.6B int4（或同量级，以 ModelScope / HF 上实际可得为准，部署时核实并把模型名、量化、digest 记入证据）。小模型能力有限 → 场景 2 的 LLM 输出一律**展示为草稿**，由既有 schema 校验与人工确认兜底。

**实测（2026-10-03，LLMA，OVMS 2026.4.0，同一条合成聚合结果，temperature 0）**：

| 模型 | 解读 HR 0.68 | 结构化 JSON | 耗时（约 100 / 50 token） | 常驻内存 |
|---|---|---|---|---|
| Qwen3-0.6B int4 | **方向说反**（写成「风险略高」） | 字段正确，但包了 ```json 围栏 | 6.4s / 2.8s | 约 1.1G |
| Qwen3-1.7B int4 | 方向正确，但**自算发生率错了一位小数**（3.0% 写成 0.30） | 字段正确，无围栏 | 18.7s / 7.1s | 约 2.5G |

结论与约束：
- 0.6B 不能用于结果解读（医学含义说反）；解读用 1.7B（用户裁决，2026-10-02）。
- 任何档位都**不许模型自己算数**：解读接口由服务端先算好并给出所有派生量（率、差值、方向词），提示词禁止出现输入之外的数字；返回后做数字回查——输出里出现输入中没有的数值即判失败、不展示。
- 结构化输出解析前先剥围栏。
- systemd 常驻的是 1.7B（`qwen3-1.7b`，回环 8000）；0.6B 模型文件留在 `/opt/models` 备查。

**任务草稿实测（2026-10-03，1.7B，沿用现有助手的系统提示词 923 token）**：单次 85 秒；输出漏了必填的 `outputPolicy`（按现有 schema 会被 422 拒掉），并编造了 `count` 与 `dataProductId`。结论：这台 2 vCPU 机器 + 1.7B **不承担任务设计助手**，助手维持 DeepSeek 不动；LLMA 只做结果解读（短提示词，实测 6–11 秒）。

### S4 不改任务设计助手，解读另立模块
新模块 `apps/api/src/result-interpreter/`，独立配置 `RESULT_INTERPRETER_LLM_BASE_URL / _MODEL / _VENDOR / _API_KEY / _EXTRA_BODY`（自托管无需 key；`_EXTRA_BODY` 用来给 Qwen3 关思考模式）。`secretflow-assistant` 一行不动。
- 原方案「把助手改成可配置 provider」——撤销：实测助手跑不动（上段），且两者的出域口径不同（助手走 CTL-11 外部闸，解读不出域），共用一套配置反而容易配错。
- **不做回落**：端点未配置 / 不可达 / 报错一律 503。回落到外部供应商等于把聚合结果送过 CTL-11。

### S5 解读接口：调用方提交结果 + 严格白名单
`POST /result-interpreter/interpret`，入参 = 研究问题文本 + 结果对象。结果对象经 zod strict 白名单（`c3ResultSchema`）：只认 `paired-cohort` 与 `disproportionality` 两类的聚合字段，未知字段即 400 且不调模型。服务端据此算出「事实清单」（率、方向词、信号判定），模型只负责措辞；输出做数字回查，出现清单与问题之外的数字即 422。产物恒带「模型生成的草稿，待研究者确认」。
- 为什么不让服务端按作业号自己去读结果：那样 agent 就在「取系统数据」，按 AGENT.md R2 必须有自有身份，而它只是一次无工具的单发调用。让调用方提交其本就有权查看的结果，agent 保持 `data-access: none`，不需要动根契约的值域。前端只挑白名单字段提交（`lib/c3-interpret-payload.ts`），发布审查清单、分层明细不带。
- 治理登记：AGT-04（`vendor: self-hosted-openvino`）、FLOW-AI-04（推理步 `crosses: none`、payload `aggregate-only`）、D-AI-2（自托管端点算控制面内部的三项成立条件，D-AI-1 预留的升级路径）、CTL-11 加适用范围注记。

**真机验证（2026-10-03，经隧道，1.7B）**：配对队列样例 11.4 秒，方向与数字全部正确；失衡检测样例 6.4 秒，数字正确但措辞偏含糊。演示以配对队列（即场景 1 的产出）为主。

### S6 网络收口：LLMA 与跨域边
**LLMA**：控制面跑在 ali29（杭州，`120.55.53.86`，与北京两个 VPC 无私网通路）。推理服务**只监听 `127.0.0.1:8000`**，不对任何网卡开放；ali29 发起 SSH 本地转发（`-L 172.17.0.1:18000:127.0.0.1:8000`，systemd 常驻、断线重连），api 容器经 docker 网桥访问 `http://172.17.0.1:18000`。LLMA 安全组入方向只留 22，来源限 ali29 与运维 IP；**域 B（`10.10.0.0/16`）与域 A 其他主机来源一律拒绝**——推理机只服务控制面，否则「LLMA 只接触 C3」只是应用层约定。
- 好处：推理端口零暴露；链路加密（C3 与提示词不在公网明文传输）；ali29 的 sshd 配置不用改。
- 备选「LLMA 公网开 8000 仅放行 ali29」——否决：明文 HTTP 过公网。
- 备选「LLMA 反向隧道到 ali29」——否决：要改生产机 sshd 的 `GatewayPorts`，且给演示机一把能登生产机的钥匙。
- 代价：LLMA 公网 IP 停机即换，隧道目标要跟着改 → 给 LLMA 绑固定 EIP，或每次开机后更新 ali29 上的隧道配置（DEPLOY 记步骤）。
- ali29 上隧道专用密钥单独生成，LLMA 侧 `authorized_keys` 用 `permitopen="127.0.0.1:8000",command="/bin/false",no-pty` 限死，只能转发这一个端口。

**跨域边（域 A ↔ 域 B）**：对等连接保留，安全组从「ALL」收紧到场景 1 实际用到的端口（证明/密钥释放通道 + 运维 22）。具体端口随 `tdx-attestation-pilot` 4.x 的通道形态确定后回填；收紧前后各做一次连通性取证。
- 备选：维持全通——否决，演示讲的就是「域间只走受控通道」，全通与叙事相悖。

### S6b 角色与域的对应
ali29 = 控制面（api + web + 链）；teeA（域 A）= 可信计算节点 / 证明方；teeB（域 B）= 校验方 / 密钥释放方。两院数据方为合成数据的软件连接器，不占 TEE 机器。对外只说「证明与密钥释放跨真实网络域」，不说「两家医院各一台 TEE」。

### S7 取证先于物料
截图清单逐条绑定证据文件（quote 摘要、验签判决、`chain_tx`、OVMS 启动日志含 AMX / 模型信息、接口响应）。视频文案出稿后过两步：`node scripts/check-tee-claims.mjs` + 对照 `external-claims.md` 两栏。
视频沿用 Remotion 按页渲染（`video/scripts/render-scenes.mjs`），新片独立成片，约 2–3 分钟，不改现有 6 分钟片。

## Risks / Trade-offs

- 场景 1 依赖的真机接线工作量最大且未开始 → 先做场景 2（独立、短），场景 1 并行推进；视频脚本按场景分页，任一场景可单独出片。
- 0.6B 模型输出质量差，画面难看 → 固定演示输入 + 草稿标注；必要时升模型档位（S3）。
- 2 vCPU 推理慢 → 视频里不出现速度数字，不做性能主张。
- Alinux 3 上 Intel PCCS 的 `tcbInfo` 过期（RECORD §3.1）→ 沿用 Intel PCS 直取；TCB 状态为 OutOfDate，文案不得写「TCB 最新」。
- teeA / teeB 无 node、无 docker → 节点镜像/运行时安装属 `tdx-attestation-pilot` 1.2，装完 MRTD 不变（度量的是固件与内核启动链），但须在实测记录里如实写。
- 按量实例停机换公网 IP → 运维入口以控制台现查为准，文档只记私网 IP。

## Open Questions

- ~~控制面跑在哪~~ 已定：ali29（2026-10-02）。连带事项：api 重建必须带 `compose.hardening.yaml`（否则 CA 根密钥重生）、`apps/api/.env` 不在 git 需手工带上新的 `ASSISTANT_LLM_*`。
- teeA / teeB 上的可信节点如何连 ali29 控制面：沿用连接器「只出站」长轮询 + SM2 证书认证，不为控制面开入站。归 `tdx-attestation-pilot` 4.1 落实。
- Intel 侧是否要求特定物料形态（方案简报 / 视频时长 / 中英文）。默认中文 2–3 分钟。
