# MedTrust 链迁移计划:FISCO BCOS → 长安链 ChainMaker

> **状态**:执行中;阶段 0/1/2/3/4 API→ChainMaker + Web 账本已通过,待命名清理
> **撰写日期**:2026-06-28
> **前置会话**:本计划源于一次对 FISCO BCOS sidecar 卡点的深度排查(详见仓库 `HANDOFF.md`)

---

## 〇、TL;DR

MedTrust 当前用 FISCO BCOS v3.6 做数据存证,但 sidecar(Java SDK 网关)在 Fly 上**无法稳定连上节点**——经多轮深度排查,根因深埋在 FISCO Java SDK 的 JNI native TLS/协议层,非应用层可修(详见附录 A)。

本计划评估迁移到**长安链 ChainMaker**的可行性与方案。核心结论:

- **可行性已本地验证通过**:业务对链依赖极薄(仅存证一个用例),合约是纯标准 Solidity,链访问被 Sidecar 完整隔离——迁移面小。
- **阶段 0/1/2/3/4 API→ChainMaker 已跑通**:ChainMaker v2.3.0 节点 + Java SDK + 现有 Solidity 合约 + HTTP Sidecar + 合并 Docker 镜像 + Fly 生产部署 + API 异步存证均已验证。
- **剩余收尾**:可清理 FISCO 命名,将 adapter/env/service label 统一为 neutral `chain`。

---

## 一、为什么迁移

### 1.1 FISCO 的真实困境(已实测验证)

本会话已穷尽验证以下方向,**全部证伪或不可控**:

| 尝试方向 | 结果 |
|---|---|
| 节点 `disable_ssl=true` + SDK `disableSsl=true`(明文) | v3 节点 RPC 20200 不讲明文 HTTP,实测 TCP 连上但空响应 |
| Java SDK 3.7.0 → 3.8.0(升级) | `certConfig` 仍空,native `bcos-sdk-jni` 卡在 3.7.0,`getClient` 同步阻塞 |
| Java SDK 3.6.0(与节点版本对齐) | TLS+WS 握手成功,但每个 RPC 请求 `socket read timeout` → session drop |
| 证书链 | `openssl verify` 实测 **OK**,CA 指纹一致,非证书问题 |
| 节点 genesis(`epoch_sealer_num`/`is_auth_check`) | 已修正并部署,问题依旧 |

**根因定位**:节点二进制 v3.6.0 + Java SDK 的 JNI native 层,WS-over-TLS 会话建立后,**每个 RPC 请求都被节点侧 socket 读超时丢弃**(`[WS][SESSION][asyncRead] message=The socket was closed due to a timeout` → `[RPC][WS][SESSION][drop]`)。该问题在 native 层,应用配置无法解决。

**这是迁移的合理性基础:已投入大量诊断,证明 FISCO 这条路在当前环境不可控地走不通。**

### 1.2 长安链的契合点

| 维度 | 说明 |
|---|---|
| 国产自主可控 | 北京微芯研究院牵头,对医疗合规场景(MedTrust)叙事契合 |
| 原生支持 Solidity/EVM | 现有合约可直接复用 |
| 纯 Java SDK(无 JNI native) | 理论上规避 FISCO 那种 native TLS 死结 |
| 国密 SM2/SM3/SM4 | 与 MedTrust 合约注释中的国密设计一致 |
| docker-compose 单机部署 | 官方有完整 quickstart |

---

## 二、迁移可行性评估:**高 ✅**

### 2.1 关键有利因素

| 维度 | 现状 | 对迁移的影响 |
|---|---|---|
| **业务对链的依赖** | 仅"存证"一个用例(`storeAttestation` 写、`getBlockNumber` 读) | **极薄**,迁移面小 |
| **合约语言** | 纯标准 Solidity 0.8.x,**无 FISCO 特有 API** | 长安链 EVM 引擎**可直接复用** |
| **架构隔离** | 链访问封装在 Sidecar(HTTP 网关)+ adapter 一个文件 | 只需**替换 Sidecar 实现**,上层 NestJS 几乎不动 |
| **接口契约** | `/attest`、`/block-number`、`/health`(HTTP/JSON) | 长安链版 Sidecar 保持**同样的 HTTP 接口**,上层零改动 |
| **长安链能力** | 原生支持 Solidity/EVM、国密、Java SDK、docker-compose | **完全覆盖** MedTrust 需求 |

> **决定性优势**:MedTrust 的 Sidecar 是一个完美的"防变异层"。FISCO 的复杂性被它全吃了,上层只认 HTTP。迁移本质 = 换掉 Sidecar 内部的"Java SDK 调 FISCO"为"Java SDK 调长安链",HTTP 契约不变。

### 2.2 现有合约的迁移友好性

`apps/api/src/blockchain/contracts/MedicalDataAttestation.sol`:
- `pragma solidity ^0.8.0` — 长安链 EVM 支持
- 仅用 mapping / struct / event / modifier — 纯标准 EVM,无 FISCO 专有 API
- `storeAttestation` / `verifyAttestation` / `getAttestationByHash` 等方法 — 长安链 EVM 均可调用
- 国密注释(SM3 hash)— 长安链原生支持国密

**结论:合约源码 + 编译产物(abi/bin)可直接复用,无需改一行。**

---

## 三、迁移范围(精确到文件)

### 3.1 必须改(核心)

| 文件 | 改动 |
|---|---|
| `fly-services/chain-sdk/`(Sidecar) | **整体重写**:换 FISCO java-sdk → 长安链 java-sdk;合约部署改用长安链 EVM 接口 |
| `fly-services/fisco-bcos-node1/` → 新建 `fly-services/chainmaker-node/` | Dockerfile 改为拉长安链节点镜像 + 生成证书 + 配置 |
| 合约编译 | 复用现有 `MedicalDataAttestation.sol`,编译产出 abi/bin 不变 |

### 3.2 几乎不改(隔离层的价值)

| 文件 | 改动 |
|---|---|
| `apps/api/.../fisco-bcos.adapter.ts` | **零改动**(仍调 `https://medtrust-chain.fly.dev/attest`)。建议后续重命名为 `chain.adapter.ts`(纯整洁,非必须) |
| `apps/api/.../health.service.ts` | **零改动**(仍调 `/block-number`) |
| `apps/web/`、其他 7 个 app | **完全不动** |

### 3.3 部署配置

- `fly.medtrust-chain.toml`:app 名、端口(8090)、健康检查基本不变(长安链版 Sidecar 仍监听 8090)
- 环境变量:`FISCO_BCOS_NODE1_URL` 语义不变(指向新 Sidecar),建议后续重命名为 `CHAIN_SIDECAR_URL`

---

## 四、分阶段实施计划

### 阶段 0:本地可行性验证(最重要,先证伪再投入)⏱ 半天

**执行结果:已通过。**

实测采用 `chainmakerofficial/chainmaker:v2.3.0` 单节点容器替代官方 quickstart 源码/`cmc`,因为 `git.chainmaker.org.cn` 匿名拉取需要认证,GitHub 镜像不可用。用 Java SDK verifier 完成同等验证:部署现有 `MedicalDataAttestation.sol`,调用 `storeAttestation`,再用 `verifyAttestation` 正反向读回。

关键实测约束:
- ChainMaker v2.3.0 EVM 不支持 Solidity 0.8.20+ 生成的 `PUSH0`;合约编译必须 pin `solc 0.8.17`。
- Java SDK 在 JDK 17 下需要 `--add-opens java.base/sun.security.util=ALL-UNNAMED`、`--add-opens java.base/java.nio=ALL-UNNAMED`、`--add-exports java.base/jdk.internal.misc=ALL-UNNAMED`。
- SDK 配置需要显式 `Pkcs11Config.enabled=false`。
- TLS 需要 `netty-tcnative-boringssl-static`,并覆盖 Guava 到 `31.1-jre` 避免传递依赖冲突。
- EVM 合约调用需用 Solidity ABI calldata 编码,并以参数 `data -> <hex calldata string bytes>` 传给 ChainMaker SDK。

**目标**:在本地/一次性容器里证明"长安链节点 + Java SDK + 现有 Solidity 合约"能跑通存证,**再动 MedTrust 代码**。

1. 用官方 docker-compose 起一个 4 节点长安链单机链(官方 `quickstart` 脚本)
2. 用 `cmc` 命令行部署 `MedicalDataAttestation.sol`(直接复用现有合约)
3. 用 `cmc` 调用 `storeAttestation` 写一条、`verifyAttestation` 读回
4. **判定标准**:能拿到 txHash + 读回数据 = 可行,进入阶段 1;否则止损

> 这一步规避了本次 FISCO 的最大教训:**先最小验证,再全量投入**。

### 阶段 1:Sidecar 重写⏱ 1-2 天

**执行结果:已通过本地 Sidecar 验证。**

已将 `fly-services/chain-sdk` 从 FISCO Java SDK 迁移到 ChainMaker Java SDK,并保持 `/health`、`/block-number`、`/attest` HTTP/JSON 契约不变。Sidecar 已能连接阶段 0 本地链,自动部署 EVM 合约并写入存证。

实测响应示例:
- `/health` → `{"status":"ok","ready":true,"blockNumber":9,"contract":"medical_data_attestation_sidecar"}`
- `/block-number` → `{"blockNumber":9}`
- `/attest` → `{"txHash":"5f8b8ff8ac72c447c11e0d8d0e03a146c68441ce363cf1c28973f49e0179212d","blockNumber":"10","status":0,"contract":"medical_data_attestation_sidecar"}`

1. `pom.xml`:FISCO java-sdk → `org.chainmaker:chainmaker-sdk-java`
2. `Sidecar.java`:初始化改用长安链 SDK(`ChainClient` + 证书);合约部署改 EVM byteCode 方式;`/attest` 改为长安链的合约调用(ABI 编码 `storeAttestation`)
3. 保持 `/health`、`/block-number`、`/attest` 的 HTTP 契约**完全不变**
4. 本地用阶段 0 的链验证 Sidecar 三个接口

### 阶段 2:Fly 部署镜像⏱ 半天

**执行结果:本地合并 Docker 镜像已通过;Fly 部署已在阶段 3 通过。**

已在现有 `fly-services/fisco-bcos-node1/Dockerfile.chain` 中构建合并镜像:编译合约(`solc 0.8.17`) + 构建 ChainMaker Java Sidecar fat jar + 复制官方 ChainMaker v2.3.0 节点。镜像本地验证命令:

```bash
docker build -f fly-services/fisco-bcos-node1/Dockerfile.chain -t medtrust-chainmaker:local .
docker run -d --name medtrust-chainmaker-local -p 18090:8090 medtrust-chainmaker:local
```

本地合并容器实测通过:
- `/health` 初始化期保持 HTTP 200: `{"status":"initializing","ready":false,"error":"starting"}`
- `/health` ready: `{"status":"ok","ready":true,"blockNumber":1,"contract":"medical_data_attestation"}`
- `/block-number`: `{"blockNumber":1}` → 写入后 `{"blockNumber":2}`
- `/attest`: `{"txHash":"8e27f71b9ed0bd237b2356f67e51e8a26c91db9f7cbac78200af17a68836f803","blockNumber":"2","status":0,"contract":"medical_data_attestation"}`

关键修复:官方 ChainMaker 镜像的节点二进制依赖 `/usr/lib/libwasmer.so`;JRE runtime stage 不能只复制 `/chainmaker-go`,必须同时从官方镜像复制 `/usr/lib/libwasmer.so`,否则节点启动后立刻退出,Sidecar 会持续报 `Connection refused: /127.0.0.1:12301`。

1. 新建 `fly-services/chainmaker-node/Dockerfile.chain`:多阶段——生成证书 + 配置 + 起长安链节点 + 起 Sidecar(同 FISCO 的"节点+Sidecar 同容器"模式)
2. 处理 CDN/镜像源问题(长安链镜像在 dockerhub/gitee,比 FISCO CDN 稳定)
3. `fly.medtrust-chain.toml` 适配

### 阶段 3:上线 + 接通⏱ 半天

**执行结果:Fly `medtrust-chain` 部署已通过。**

部署命令必须从 repo root 执行,并显式传入 Dockerfile,因为 `Dockerfile.chain` 的 `COPY` 路径以仓库根目录为 build context:

```bash
flyctl deploy . \
  --config fly-services/fisco-bcos-node1/fly.medtrust-chain.toml \
  --dockerfile fly-services/fisco-bcos-node1/Dockerfile.chain \
  --remote-only \
  --wait-timeout 8m
```

不要从 `fly-services/fisco-bcos-node1` 目录直接运行 `flyctl deploy --config fly.medtrust-chain.toml`,否则 Depot 只上传该子目录作为 build context,会找不到 `apps/api/...` 和 `fly-services/chain-sdk/...`。

Fly 部署结果:
- App: `medtrust-chain`
- URL: `https://medtrust-chain.fly.dev/`
- Image: `medtrust-chain:deployment-01KW92NX4HW3R1R54989M824GN`
- Machine: `683d610a00e358`, version `16`, region `sin`, check `1 passing`

公网验证已通过:
- `/health`: `{"status":"ok","ready":true,"blockNumber":1,"contract":"medical_data_attestation"}`
- `/block-number`: `{"blockNumber":1}` → 写入后 `{"blockNumber":2}`
- `/attest`: `{"txHash":"f8c4e24bb621806813254303f87268fc102cb24efba7620975c771574f7c887e","blockNumber":"2","status":0,"contract":"medical_data_attestation"}`

Fly deploy 输出有一个非阻塞 DNS warning: `expected 1 AAAA records for medtrust-chain.fly.dev., got 0`;公网 HTTPS 实测可访问,Fly machine health check 通过。

1. `flyctl deploy` 新镜像到 `medtrust-chain`
2. 验证 `https://medtrust-chain.fly.dev/health` → `ready:true` + `contract:0x...`
3. 验证 `/attest` 返回真实 txHash
4. `medtrust-api` 无需重新部署(adapter 未变)——但建议重部署确认 `FISCO_BCOS_NODE1_URL` 指向新 Sidecar

### 阶段 4:端到端 + 收尾⏱ 半天

**执行结果:API → ChainMaker 端到端已通过;Web 账本已接真实 blockchain API。**

先发现生产 API 仍运行旧镜像:`/api/v1/health` 中 `fisco-bcos` 检查返回 404,但从 API machine 内部直接 `fetch("https://medtrust-chain.fly.dev/block-number")` 返回 200。进一步检查运行中编译产物发现没有 `/block-number` 字符串,根因是 `medtrust-api` 未部署包含新 health/adapter 代码的镜像。

已部署当前 API 镜像:

```bash
flyctl deploy . \
  --config fly-services/api/fly.toml \
  --dockerfile fly-services/api/Dockerfile \
  --remote-only \
  --wait-timeout 8m
```

部署结果:
- API image: `medtrust-api:deployment-01KW9449H3CR9TWSFS3E9BCQRN`
- Machine: `d8917e0f337968`, version `9`, region `sin`, check `1 passing`
- API env: `FISCO_BCOS_NODE1_URL=https://medtrust-chain.fly.dev`

API health 验证:
- `GET https://medtrust-api.fly.dev/api/v1/health`
- `fisco-bcos` service 从 `unhealthy/404` 变为 `healthy`

API 存证端到端验证:
- 登录 demo 账号: `admin@demohospa-hospital.com` / `demo123456`
- `POST /api/v1/blockchain/attest` 创建 attestation `id=1`
- 异步 worker 调用 ChainMaker Sidecar 成功
- `GET /api/v1/blockchain/attestations/1` 返回 `status="confirmed"`
- 保存 tx: `e3f3b2c3c993045214a06ef3c578bea9eecb59a82af53e885e4716f73fcd2bdd`
- Sidecar block height 从 `3` 增加到 `4`

Web 账本接入:
- `apps/web/src/app/(console)/space/attestations/page.tsx` 已移除 mock ledger,改为渲染客户端组件 `AttestationsLedger`。
- `AttestationsLedger` 使用既有 Web API client 调用 `GET /api/v1/blockchain/attestations`。
- 新增 `apps/web/src/lib/attestations.ts` / `.mjs` 将 API attestation 映射为 ledger row,并用 Node `node:test` 覆盖 confirmed 和 pending 记录。
- `apps/web/package.json` 新增 `test` 脚本: `node --test src/lib/*.test.mjs`。

Web/API 联调修复:
- 发现 `POST /blockchain/attest` 可创建并确认单条记录,但 `GET /blockchain/attestations` 返回 `[]`。
- 根因:JWT strategy 暴露 `userId`,不暴露 `tenantId`;`createAttestation` 用 `req.user.tenantId` 创建了 nullable tenant 记录,而 list 查询无条件加 `attestation.tenantId = :tenantId` 且 `tenantId` 为 `undefined`。
- 修复: `BlockchainService.getAttestations` 仅在 `tenantId` 是 number 时加 tenant predicate,否则不过滤 tenant;可选 filters 仍正确选择 `where`/`andWhere`。
- 新增回归测试: `apps/api/src/blockchain/blockchain.service.spec.ts` 覆盖 JWT 无 tenant id 时不按 `undefined` tenant 过滤。

生产验证:
- API image: `medtrust-api:deployment-01KW988T1S6D491VN0NGBTVYBK`, machine `d8917e0f337968`, check `1 passing`。
- Web image: `medtrust-web:deployment-01KW98FB2EW9HBX174A7K2P8EQ`, active machine `d8d0137cee39e8`, check `1 passing`。
- `GET https://medtrust-web.fly.dev/space/attestations` 返回 `200`。
- 通过 API 新建 attestation `web-ledger-final-1782722426`,状态从 `pending` 变为 `confirmed`,tx `7e4a96c4ee2c03873b889c9777a521d176588b7c7a56bc18807da56ba578077b`,block `7`。
- `GET /api/v1/blockchain/attestations` 返回该 confirmed 记录,Web ledger 登录后可读取同一真实数据源。

1. Web 登录 → 触发存证 → 真实 txHash
2. 更名清理(`fisco-bcos.adapter.ts` → `chain.adapter.ts`、env 重命名)——**可选,非必须**
3. 更新 `HANDOFF.md` + 删除 FISCO 相关文件

---

## 五、Sidecar HTTP 契约(必须保持不变)

上层 NestJS adapter 依赖以下接口,长安链版 Sidecar 必须**逐字保持**:

### `GET /health`
```json
// ready 时(恒 200,readiness 放 body,Fly 健康探针不会踢出)
{"status":"ok","ready":true,"blockNumber":42,"contract":"0x..."}
// 初始化中
{"status":"initializing","ready":false,"error":"starting"}
```

### `GET /block-number`
```json
{"blockNumber":42}
```

### `POST /attest`
请求:
```json
{"dataHash":"0x<64 hex>","dataType":"data_sharing","metadata":"{}"}
```
响应:
```json
{"txHash":"0x...","blockNumber":"42","status":0,"contract":"0x..."}
```
> `status:0` = 成功(FISCO 回执语义);长安链版需映射为同样的 0=成功约定。

---

## 六、风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 长安链 Java SDK 也有 native/连接坑 | 中 | **阶段 0 强制证伪**;长安链 SDK 是纯 Java(无 JNI native),理论上无 FISCO 那种 TLS 死结 |
| Docker-VM(跑 Go 合约)需 Linux——但我们用 EVM 不需要 | 低 | 已确认:EVM 合约**不需要** Docker-VM,规避此限制 |
| 合约 `block.timestamp`/`msg.sender` 在长安链 EVM 的语义差异 | 低 | 阶段 0 的 `cmc` 调用会暴露;长安链 EVM 兼容性文档明确支持 |
| Fly 上长安链节点资源占用 | 低 | 长安链单节点比 FISCO 轻(纯 Go,无 JVM 节点) |
| 沉没成本心理(已投入 FISCO 大量调试) | — | 接受沉没;迁移面小,后续维护更可控 |

---

## 七、关键判断:要不要迁移?

### 支持迁移
- FISCO 已被实测证明在当前环境不可控地卡死,继续投入产出比低
- 长安链是国产自主可控品牌,对医疗合规场景叙事更契合
- 迁移面**极小**(Sidecar 隔离层设计是关键护城河)
- 阶段 0 可低成本证伪

### 反对 / 需权衡
- 已在 FISCO 投入大量调试成本(沉没,但需心理接受)
- 长安链也有学习曲线和未知坑

### 建议
**执行阶段 0(本地验证,半天成本)再决定**。如果阶段 0 通过,迁移总成本约 3-4 天,且上层零改动——性价比远高于继续和 FISCO native 层死磕。

---

## 八、参考文档

- [长安链官方文档](https://docs.chainmaker.org.cn/)
- [智能合约开发(支持 Solidity/EVM)](https://docs.chainmaker.org.cn/dev/智能合约.html)
- [Java SDK 使用说明(含 EVM 合约部署调用)](https://docs.chainmaker.org.cn/sdk/JavaSDK使用说明.html)
- [通过命令行工具启动链(docker-compose 单机)](https://docs.chainmaker.org.cn/quickstart/通过命令行工具启动链.html)
- [通过 Docker 部署链](https://docs.chainmaker.org.cn/v2.3.0/html/instructions/通过Docker部署链.html)
- [Go SDK 使用说明 v3.0.0](https://docs.chainmaker.org.cn/v3.0.0/html/sdk/GoSDK使用说明.html)
- [合约调用(ABI 编码 + 证书/EVM 地址转换)](https://cloud.tencent.com/document/product/663/72550)

---

## 附录 A:FISCO 卡点排查纪要(迁移决策的证据基础)

本次会话对 FISCO sidecar 做了 7+ 次部署和系统排查,关键证据链:

1. **TLS 握手成功**(console 的 cpp_sdk 日志:`ssl async_handshake success` + `websocket handshake successfully` + `connected nodes,count=1`)
2. **证书链验证 OK**(`openssl verify -CAfile ca.crt ssl.crt` → OK;节点 CA 与 SDK CA 指纹完全一致)
3. **节点 RPC 方法表正常**(`[RPC][JSONRPC][initMethod] size=25`,含 getBlockNumber)
4. **但每个 RPC 请求都被丢弃**:节点日志 `[WS][SESSION][asyncRead] message=The socket was closed due to a timeout` → `[RPC][WS][SESSION][drop] reason=4294963295`
5. 客户端侧表现为 `[SDK][WS][SESSION][onRespTimeout]`,10s 后无响应

**已证伪的方向**:SSL off、disableSsl、certPath 填充、SDK 3.7/3.8 升级、版本错配、证书链、节点 genesis(`epoch_sealer_num`/`is_auth_check`)。

**结论**:问题在 FISCO Java SDK JNI native 层的 WS-over-TLS 数据传输,非应用配置可解。

> 注:排查过程中一度误判为"SDK CertConfig 不填充 bug",后经 console cpp_sdk 日志推翻——真实情况是 TLS 握手本身成功,卡点在握手后的应用数据传输阶段。
