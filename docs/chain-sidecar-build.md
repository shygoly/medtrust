# Chain SDK Sidecar — jar 构建过程

> **背景**:`fly-services/chain-sdk/target/` 下的 Maven 构建产物(`chain-sidecar.jar` ~39MB 等)曾经被误提交进 git。现已从历史移除并加入 `.gitignore`。本文档记录 jar 的构建方式,确保任何人都能复现,而不依赖仓库里的二进制。

---

## 1. 这是什么

`chain-sidecar.jar` 是 MedTrust 区块链存证 sidecar 的可执行 fat-jar:

- **源码**:`fly-services/chain-sdk/src/main/java/medtrust/Sidecar.java`
- **入口**:`medtrust.Sidecar`(`main` 方法,内置 `com.sun.net.httpserver` HTTP server)
- **依赖**:ChainMaker Java SDK(`org.chainmaker:chainmaker-sdk-java`)+ snakeyaml + protobuf + guava + netty boringssl + slf4j
- **作用**:在 ChainMaker 节点同容器内,提供 HTTP 网关(`/attest`、`/block-number`、`/health`),把 NestJS API 的存证请求转译成 ChainMaker 合约调用

## 2. 三种构建方式

### 方式 A:Fly 远程构建(生产,推荐)

**这是线上 `medtrust-chain.fly.dev` 实际用的方式**——jar 在 Fly 的 Depot 远程构建机里生成,从不上传本地、不进 git。

```bash
# 从仓库根目录执行(Docker build context = 仓库根)
flyctl deploy . \
  --config fly-services/chainmaker-node/fly.medtrust-chain.toml \
  --dockerfile fly-services/chainmaker-node/Dockerfile.chain \
  -a medtrust-chain --remote-only --ha=false --yes
```

`Dockerfile.chain` 的多阶段构建里,`java` 阶段会编译出 jar,`runtime` 阶段把它 COPY 进最终镜像:

```dockerfile
# Dockerfile.chain 关键阶段
FROM maven:3.9-eclipse-temurin-17 AS java
WORKDIR /src
COPY fly-services/chain-sdk/pom.xml ./pom.xml
RUN mvn -q -e dependency:go-offline || true          # 预热依赖
COPY fly-services/chain-sdk/src ./src
RUN mvn -e -B clean package                           # ← 产出 target/chain-sidecar.jar

FROM eclipse-temurin:17-jre
# ... chainmaker 节点二进制 ...
COPY --from=java /src/target/chain-sidecar.jar /app/chain-sidecar.jar
COPY fly-services/chain-sdk/start.sh /app/start.sh
```

> **不需要本地有 Docker daemon**——`--remote-only` 让 Fly 在它的构建机上跑。

### 方式 B:本地构建(开发/调试)

需要本地有 JDK 17 + Maven。

```bash
cd fly-services/chain-sdk
mvn -e -B clean package
# 产出:target/chain-sidecar.jar(fat-jar,含所有依赖)
```

验证能跑:

```bash
java -jar target/chain-sidecar.jar
# 应输出 [sidecar] HTTP listening on :::8090(需 ChainMaker 节点在 localhost 才能完成 init)
```

### 方式 C:只编译不打包(快速验证语法)

```bash
cd fly-services/chain-sdk
mvn -e -B compile              # 只编译,不出 jar
```

## 3. 运行时要求

jar 在最终镜像里由 `start.sh` 启动,需要这些 JVM flags(JDK 17 强封装下,反射访问内部模块必须显式 open):

```bash
exec java \
  --add-opens java.base/sun.security.util=ALL-UNNAMED \
  --add-opens java.base/java.nio=ALL-UNNAMED \
  --add-exports java.base/jdk.internal.misc=ALL-UNNAMED \
  -jar /app/chain-sidecar.jar
```

环境变量(在 `fly.medtrust-chain.toml` 里设):

| 变量 | 默认 | 说明 |
|---|---|---|
| `SIDECAR_PORT` | `8090` | HTTP 监听端口 |
| `CHAIN_RPC_PEER` | `127.0.0.1:20200` | ChainMaker 节点 RPC(同容器 localhost) |
| `CHAIN_CERT_DIR` | `/data/sdk` | 证书目录 |
| `CHAIN_GROUP` | `group0` | 链 group |

## 4. 为什么 jar 不进 git

- **体积**:`chain-sidecar.jar` 是 ~39MB 的 fat-jar,会让仓库 clone 变慢、历史膨胀
- **可复现**:`pom.xml` + `src/` 完全确定构建结果,jar 是衍生品,任何时候都能重建
- **安全**:fat-jar 打包了第三方依赖,固定进 git 会让 CVE 修复难以追溯
- **.gitignore 规则**:`fly-services/chain-sdk/target/`(已加)

如果之前 clone 过含 jar 的旧版本,清理本地:

```bash
git pull
rm -rf fly-services/chain-sdk/target/   # 删除遗留的构建产物
```

## 5. 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `mvn` 报 JDK 版本不对 | 需要 JDK 17 | `sdk use java 17.0.x-tem` 或装 temurin-17 |
| `Fatal error compiling`(注解处理器) | JDK 17 强封装阻断反射 | pom.xml 已钉 `maven-compiler-plugin:3.11.0` + `<proc>none</proc>` |
| jar 构建成功但运行报 `UnsatisfiedLinkError` | netty boringssl native 库缺失 | pom 已含 `netty-tcnative-boringssl-static`,检查 classpath |
| Fly 构建报 `Could not resolve chainmaker-sdk-java` | Maven Central 偶发 | 重试,或检查 pom.xml 的仓库配置 |

## 6. 相关文件

- `fly-services/chain-sdk/pom.xml` — Maven 构建定义(依赖、shade 插件、mainClass)
- `fly-services/chain-sdk/src/main/java/medtrust/Sidecar.java` — 源码
- `fly-services/chain-sdk/start.sh` — 运行时启动脚本
- `fly-services/chainmaker-node/Dockerfile.chain` — 多阶段构建(JDK17 编译 → JRE17 运行)
- `fly-services/chainmaker-node/fly.medtrust-chain.toml` — Fly 部署配置
- `.gitignore` — 已忽略 `fly-services/chain-sdk/target/`
