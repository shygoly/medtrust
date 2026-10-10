# MedTrust — 部署/集成任务交接文档

> 交接给后续模型/工程师。目标：把 medtrust 的 8 个 Fly app 从「mock 桩」全部换成「真实实现」，并让控制面（NestJS API）真正联动这些后端。
> 当前进度：**7/8 已是真实并在线；第 8 个（chain 的"存证写链"）正在做 FISCO SDK sidecar，卡在一个已定位、已知修法的点上**（见 §5）。

写于 2026-06-28。环境：本地 **无 docker daemon**，所有镜像走 `flyctl deploy --remote-only`（depot 远程构建，每次几分钟）。Fly org=`personal`，账号 `sgl1226@gmail.com`。

---

## 1. 总览：8 个 app 现状

| app | 真实实现 | 状态 | 验证 |
|---|---|---|---|
| medtrust-api | NestJS 控制面 (`apps/api`) | ✅ 真实在线 | `curl https://medtrust-api.fly.dev/api/v1/health`（注意根 `/` 无路由，用 `/api/v1/health`） |
| medtrust-web | Next.js 16 控制台 (`apps/web`) | ✅ 真实在线 | `https://medtrust-web.fly.dev/login` 200 |
| medtrust-vault | 官方 `hashicorp/vault:1.18` dev | ✅ 真实在线 | `/v1/sys/health` 200 |
| medtrust-fl | 真 Flower SuperLink | ✅ 真实在线（gRPC，根 `/` 无 HTTP=正常） | `flyctl status -a medtrust-fl` 看 checks passing |
| medtrust-mpc | 真 MP-SPDZ 引擎 + Flask 网关 | ✅ 真实在线 | `https://medtrust-mpc.fly.dev/health` → `{"protocol":"shamir","status":"healthy"}` |
| medtrust-connector-a | 真 Python Local Data Agent (`apps/agent`，torch+gRPC) sin | ✅ 真实在线（gRPC/WS，根无 HTTP=正常） | `flyctl status -a medtrust-connector-a` checks passing |
| medtrust-connector-b | 同上，nrt | ✅ 真实在线 | `flyctl status -a medtrust-connector-b` |
| **medtrust-chain** | 真 FISCO BCOS v3.6 节点 **+ 同容器 Java SDK 网关(sidecar)** | 🚧 **进行中**（节点真实在线；读已通；写链 sidecar 卡在 §5） | 见 §5 |

> 根路径 `/` 对 fl / connector-a / connector-b 返回 000 是**正常**的——它们是 gRPC/TCP 服务，不在 HTTP `/` 上响应；用 `flyctl status` 看健康检查。api/chain 若返回 000 请先 `flyctl machine start` 复核（immediate 部署可能留 stopped）。

控制面联动现状：
- API → connector：已 `flyctl secrets set AGENT_GRPC_URL=medtrust-connector-a.internal:5024 -a medtrust-api`（orchestrator 派发真实 agent）。
- API → MPC：已 `flyctl secrets set MP_SPDZ_GATEWAY_URL=https://medtrust-mpc.fly.dev -a medtrust-api`，health 里 mp-spdz=healthy。
- API → chain：已设 `FISCO_BCOS_NODE1_URL=https://medtrust-chain.fly.dev`（在 `fly-services/api/fly.toml`），健康检查参数已改 3.x 格式 `["group0","node0"]`。**注意**：chain 改成 sidecar 架构后，公网 `https://medtrust-chain.fly.dev` 现在是 **sidecar(8090)** 而非裸 RPC，所以 API 那个 JSON-RPC 健康检查/读 adapter 需要改为调 sidecar 端点（见 §6 待办）。

---

## 2. 演示账号（统一密码 `demo123456`）

| 角色 | 账号 | participantRole |
|---|---|---|
| 医院/数据提供 | `admin@demohospa-hospital.com`、`admin@rjh.com.cn` | provider |
| 药企/数据使用 | `research@meddata-inst.edu.cn`、`contact@smartmed-ai.com` | consumer |
| 治理/监管 | `data-governance@health.gov.cn` | operator |
| 合规方（本次新增） | `compliance@medtrust.org` | compliance |

合规角色是本轮新增的端到端功能：`packages/database` user 实体 participantRole 增 `'compliance'`；`apps/api/src/auth/auth.service.ts` seed 账号；`apps/web` 的 `lib/auth.ts`(roleLabel)、`components/console/space-nav.tsx`(按角色门控的「合规·COMPLIANCE」分组)、`app/(console)/space/compliance/{page,alerts/page}.tsx`、`lib/compliance.ts`、登录页快捷入口。

---

## 3. 部署机制与命令（重要：复用模式）

镜像/配置都在 `fly-services/<svc>/`。Node monorepo 服务多阶段构建、**构建上下文 = 仓库根**。从仓库根执行：

```bash
# api（web 同理，换 config/dockerfile）
flyctl deploy . --config fly-services/api/fly.toml --dockerfile fly-services/api/Dockerfile -a medtrust-api --remote-only --ha=false --yes

# 镜像内自包含的服务（vault/fl/mpc）：cd 进目录再 deploy（上下文=该目录）
cd fly-services/fl-server && flyctl deploy --config fly.medtrust-fl.toml --dockerfile Dockerfile -a medtrust-fl --remote-only --ha=false --yes

# connector-b 复用 connector-a 镜像（免重建）
flyctl deploy --config fly-services/connector/fly.connector-b.toml --image registry.fly.io/medtrust-connector-a:<deployment-tag> -a medtrust-connector-b --strategy immediate --ha=false --yes

# 运行期 env（不触发重建，仅重启机器）
flyctl secrets set KEY=VALUE -a medtrust-api
```

### 踩过的坑（务必牢记）
1. **fly.toml 的 `[build].dockerfile` 路径相对 config 文件目录解析** → 写全路径会重复成 `fly-services/api/fly-services/api/Dockerfile`。要么写相对名 `Dockerfile`，要么用 CLI `--dockerfile <repo相对路径>` 覆盖。
2. **`.internal` 私网是 IPv6**；很多服务默认绑 `0.0.0.0`(仅 IPv4) → 跨 app 经 `.internal` 连不上。对策：服务对外用**公网 URL**，或让进程绑 IPv6（Java `new InetSocketAddress("::", port)`；Linux 双栈也收 IPv4）。
3. **API 必须 `NODE_ENV=development`**（`fly-services/api/fly.toml`）：production 下 TypeORM `synchronize` 关→临时 SQLite 无表；且 `VaultService.onModuleInit` 连不上 Vault 会硬崩。dev 模式同时解决建表+seed 与 Vault 优雅降级。数据是 ephemeral SQLite，靠各服务 `OnModuleInit` seeder 自动填充，无需持久卷。
4. **`NEXT_PUBLIC_*` 构建期注入**：web 的 `NEXT_PUBLIC_API_URL` 必须经 `[build.args]` 传且带 `/api/v1`。next.config 已 `output:"standalone"` + `outputFileTracingRoot=仓库根`。
5. **`--strategy immediate`** 可绕开 Fly 健康轮询偶发的 `request canceled` 假超时；之后自行验证 + 必要时 `flyctl machine start <id>`。
6. **connector 的真实节点是 `apps/agent`(Python)**，不是 `apps/connector`(那套 NestJS 是不接入实时控制面的自包含 demo)。agent 依赖 torch/grpcio/**protobuf**/**pyyaml**(pyproject 核心列表不全)；且 `apps/agent/src/medtrust_agent/scenario.py` 用 `Path(__file__).parents[4]` 取仓库根读 `packages/demo-scenario/src/ckd-scenario.json` → 镜像里要保留 `apps/agent/src/...` 目录深度并带上该 json。

记忆已写入 `~/.claude/.../memory/real-apps-fly-deploy.md`。

---

## 4. chain 节点本身（已真实在线）

`fly-services/fisco-bcos-node1/Dockerfile.chain` + `fly.medtrust-chain.toml`。真 FISCO BCOS v3.6.0 air 单节点。build_chain.sh 的 3 个 CDN 依赖都被绕过：
- **tassl**（403）→ gen 阶段 `ln -sf $(which openssl) /root/.fisco/tassl-1.1.1b`（非国密链 openssl 即可，脚本见文件已存在就跳过下载）。
- **二进制**（脚本拼的 GitHub URL 漏了 `v` → 404）→ 自己下 `…/download/v3.6.0/fisco-bcos-linux-x86_64.tar.gz` 解压，用 `-e ./fisco-bcos` 传入。
- **get_account.sh**（403）→ 用 `-a 0x<40hex>` 提供 auth-committee admin 跳过（节点出块不需要该账户私钥）。
- 运行层用官方 `fiscoorg/fiscobcos:v3.6.0`（自带 `libproviders.so`+正确 loader；tarball 二进制缺这些）。**该镜像 ENTRYPOINT 已是 `fisco-bcos`**，所以传参不要再带二进制名。
- 合约 `apps/api/src/blockchain/contracts/MedicalDataAttestation.sol` 用 solc 0.8.11 在 gen 阶段编译出 `/app/contract/MedicalDataAttestation.{abi,bin}`（标准 EVM，函数 `storeAttestation(bytes32,string,string)`、`verifyAttestation(bytes32)` 等）。

FISCO 3.x RPC：端口 **20200**，`config.ini [rpc]` 默认 `disable_ssl` 注释掉(=SSL 开)、`sm_ssl=false`(非国密)。曾验证：开 `disable_ssl=true` 后可走**纯 HTTP JSON-RPC**：
```bash
curl -X POST https://medtrust-chain.fly.dev -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"getBlockNumber","params":["group0","node0"],"id":1}'
# → {"jsonrpc":"2.0","result":0}
```
（但当前 chain 已转向 sidecar 架构，公网入口给了 sidecar，见 §5。）

---

## 5. 🚧 活跃任务：FISCO SDK sidecar（让存证真正写链）

### 为什么需要 sidecar
FISCO BCOS 3.x **没有可用的 Node SDK**（npm 上 `fisco-bcos`/`@zhennann/fisco-bcos` 都是 2.x，协议不兼容）。3.x 交易需 **Tars 编码 + secp256k1 签名**，进程内 JS 写不可行。读可以走纯 HTTP JSON-RPC，但**写**必须靠官方 SDK。选了 **Java SDK**（纯 JVM、权威、无原生库）。

### 架构（已决定并基本搭好）
**与节点同容器**（消除跨 app 证书分发 + IPv6 网络问题）：
- 一个进程 = FISCO 节点（后台）+ Java sidecar（前台），见 `fly-services/chain-sdk/start.sh`。
- sidecar = `fly-services/chain-sdk/`（Maven 项目，`pom.xml` + `src/main/java/medtrust/Sidecar.java`），用 `org.fisco-bcos.java-sdk:fisco-bcos-java-sdk:3.7.0`，JDK 内置 `HttpServer`。
- sidecar 连 **localhost:20200** 节点，启动时部署 `MedicalDataAttestation` 合约、存地址，暴露纯 HTTP：
  - `GET /health`（恒 200，带 `ready`/`error`/`blockNumber`/`contract`）
  - `GET /block-number`
  - `POST /attest {dataHash,dataType,metadata}` → `storeAttestation` 交易 → `{txHash,blockNumber,status,contract}`
- Fly 暴露 sidecar 的 **8090** 于 443/80（`fly.medtrust-chain.toml` 已是 `[http_service] internal_port=8090`）。节点 RPC 只在 localhost。
- 运行镜像 = `fiscoorg/fiscobcos:v3.6.0` + `openjdk-17-jre-headless` + node 配置 + (原计划的)证书 + 合约 abi/bin + sidecar jar；`ENTRYPOINT []` 覆盖，`CMD ["/app/start.sh"]`。

### 已解决的子问题（按时间）
- Maven `Fatal error compiling`（JDK17 强封装下传递依赖的注解处理器反射 jdk.compiler 失败）→ `pom.xml` 钉 `maven-compiler-plugin:3.11.0` + `<proc>none</proc>`。**已修，BUILD SUCCESS。**
- `TransactionReceipt.getBlockNumber()` 返回 `BigInteger` 非 String → `Sidecar.java` 用 `String.valueOf(...)`。**已修。**
- sidecar `HttpServer` 绑 `0.0.0.0`(IPv4) → Fly IPv6 代理不可达 → 改绑 `"::"`。**已修**（注意日志里 "HTTP listening on 0.0.0.0" 那行**文案没改**，但实际已绑 `::`）。
- `/health` 初始化中返回 503 → Fly 健康探针也打 /health → 503 把后端踢出 → 外部永远不可达（死锁）→ 改 **/health 恒 200**，readiness 放 body。**已修。**
- SDK 日志被吞（`SLF4J StaticLoggerBinder` 缺失）→ `pom.xml` 加 `org.slf4j:slf4j-simple:1.7.36`，SDK 日志现可见。**已修。**

### ⛔ 当前卡点（已定位 + 已知修法，尚未应用）
日志显示 SDK 初始化时 JNI 配置为：`disableSsl=false, sslType='ssl', certConfig=CertConfig{}` —— **证书没读进去**（我设的 `cryptoMaterial.certPath` 在编程式 ConfigProperty 下没生效），于是用 SSL 但无证书，TLS 握手在 `timeout=-1` 下**永久卡住**（既无 "chain ready" 也无报错——之前的静默 hang 就是这个）。

**修法（最简，免证书）**：节点开 `disable_ssl=true`（明文 RPC），SDK 设 `disableSsl=true`，两边一致。已查证 SDK 源码 `CryptoMaterialConfig`：键名是 **`disableSsl`**，且按**字符串**解析（`Boolean.parseBoolean((String) value)`），设了就跳过证书加载。

### 下一步（精确动作）
1. **`fly-services/chain-sdk/src/main/java/medtrust/Sidecar.java`**（`initChain()` 里，当前第 ~72-74 行）：
   把
   ```java
   Map<String, Object> crypto = new HashMap<>();
   crypto.put("certPath", certDir);
   property.setCryptoMaterial(crypto);
   ```
   改为
   ```java
   Map<String, Object> crypto = new HashMap<>();
   crypto.put("disableSsl", "true"); // 字符串！SDK 内部 (String) 强转后 Boolean.parseBoolean
   property.setCryptoMaterial(crypto);
   ```
   （`certDir` 变量可留可删。）
2. **`fly-services/fisco-bcos-node1/Dockerfile.chain`** gen 阶段：在 `build_chain.sh` 那行（第 15 行）之后、`echo "==== TREE"` 之前，重新加上让节点明文 RPC 的 sed（之前走证书路线时删掉了）：
   ```dockerfile
   RUN sed -i 's/;disable_ssl=true/disable_ssl=true/' nodes/127.0.0.1/node0/config.ini
   ```
   （listen_ip 保持默认 127.0.0.1 即可，因为 sidecar 走 localhost。）
3. 重新部署 chain（从仓库根）：
   ```bash
   flyctl deploy . --config fly-services/fisco-bcos-node1/fly.medtrust-chain.toml \
     --dockerfile fly-services/fisco-bcos-node1/Dockerfile.chain -a medtrust-chain \
     --remote-only --ha=false --strategy immediate --yes
   ```
   部署后可能需 `flyctl machine start <id> -a medtrust-chain`（取 id：`flyctl machines list -a medtrust-chain`）。
4. 验证（节点启动+JVM+合约部署约 1-2 分钟）：
   ```bash
   curl -s https://medtrust-chain.fly.dev/health     # 期望 {"status":"ok","ready":true,"contract":"0x..."}
   curl -s -X POST https://medtrust-chain.fly.dev/attest \
     -H 'Content-Type: application/json' \
     -d '{"dataHash":"0x'$(printf 'a%.0s' {1..64})'","dataType":"data_sharing","metadata":"{}"}'
   # 期望 {"txHash":"0x...","blockNumber":"...","status":0,...}  ← 真实落链
   ```
   看 SDK/部署日志：`flyctl logs -a medtrust-chain --no-tail | grep -iE "chain ready|init attempt|contract|Exception"`（取日志后过滤 `Metrics token`/`context canceled` 噪声）。
5. 若仍 hang：JNI 配置应变成 `disableSsl=true`；若变了仍连不上，检查节点 RPC 是否真的明文（`flyctl ssh console -a medtrust-chain --machine <id> -C "/bin/sh -lc 'grep disable_ssl /data/node0/config.ini'"`）。若 SDK 报 ABI/部署错误，按报错调 `Sidecar.java` 的 `deployAndGetResponse`/`sendTransactionAndGetResponse` 调用。

---

## 6. sidecar 跑通后的收尾（NestJS 接线）

让"存证经 API 落链"端到端：把 `apps/api/src/blockchain/adapters/fisco-bcos.adapter.ts`（当前 `submitAttestation` 仍是 mock；`getBlockNumber` 已用 fetch 但直连节点 RPC，chain 转 sidecar 后应改指 sidecar）改为调用 sidecar：
- `submitAttestation(data)` → `POST https://medtrust-chain.fly.dev/attest {dataHash,dataType,metadata}` → 返回真实 `{txHash,blockNumber}`。
- `getBlockNumber()` → `GET https://medtrust-chain.fly.dev/block-number`。
- `verifyAttestation` → 可在 sidecar 加 `POST /verify`（调合约 `verifyAttestation` view），或暂留。
- `apps/api/src/health/health.service.ts` 的 `checkFiscoBcos`：现在打 `FISCO_BCOS_NODE1_URL` 的 JSON-RPC，但该 URL 已是 sidecar→改为 `GET {url}/health` 即可（sidecar /health 恒 200）。或把 `FISCO_BCOS_NODE1_URL` 仍指 sidecar 并改检查方式。
- 改完重新部署 api（§3 命令）。验证：用合规/任意账号登录 web → 触发存证 → 看 `medtrust-chain.fly.dev/attest` 真实 txHash；`flyctl logs -a medtrust-chain` 看合约调用。

---

## 7. 关键文件索引
- 部署产物：`fly-services/{api,web,vault,fl-server,mp-spdz-gateway,connector,fisco-bcos-node1,chain-sdk}/`，根 `.dockerignore`。
- FISCO sidecar：`fly-services/chain-sdk/{pom.xml, start.sh, src/main/java/medtrust/Sidecar.java}` + `fly-services/fisco-bcos-node1/{Dockerfile.chain, fly.medtrust-chain.toml}`。
- 合约：`apps/api/src/blockchain/contracts/MedicalDataAttestation.sol`。
- API 区块链模块：`apps/api/src/blockchain/`（adapter/service/controller/config）。
- 合规功能：见 §2。
- 记忆：`~/.claude/projects/-Users-mac-Sync-project-medtrust/memory/real-apps-fly-deploy.md`。

> 注意 `CLAUDE.md` 里若干"已知坑"已过时（如 `main.ts` 的 `useGlobalPipe` 拼写——实际已是 `useGlobalPipes`；"Fly 部署是 mock"——api/web/vault/fl/mpc/connector 已真实）。以代码与本文件为准。
