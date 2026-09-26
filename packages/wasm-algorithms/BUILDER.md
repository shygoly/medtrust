# 隔离构建器 —— 第三方算法模块的编译环境

> 归属：`third-party-module-admission` 闸 0 + 闸 2；治理见 `TRUST.md` CTL-24、`DECISIONS.md` D-CN-5。

## 为什么要独立环境（不是「顺手放进 api 容器」）

`cargo build` 会执行第三方的 `build.rs` 与 proc-macro，`asc` 会 `require()` `asconfig.json`
里声明的 `transform`。**编译期本身就是一个完整的代码执行点**，而闸 1 只看产物 `.wasm`、
闸 3 只看运行期——编译期不被后面任何一道闸覆盖。

两个看似省事、实则更糟的做法：

| 做法 | 为什么不行 |
|---|---|
| 把 rustc/cargo 装进 api 镜像 | 控制面对外提供 HTTP，把准入闸最薄弱的一环安在最不该安的地方；第三方源码会在持有 CA 私钥的容器里被编译 |
| api 挂 `docker.sock` 去「隔离」 | docker socket ≡ 宿主 root。比装编译器更糟 |

所以：**编译在本环境完成，判定由控制面自己做**。控制面不执行任何被提交的内容，
但 SM3、复现比对、闸 1 全部由它亲自算（纯读字节，零风险）。

## 两道防线

1. **闸 0 源码预检**（`src/source-gate.ts`，编译**之前**跑）——从机制上排除编译期执行点：
   `build.rs` / `[package].build` / `[build-dependencies]` / 非空依赖 / proc-macro crate /
   `.cargo/config.toml`（可设 runner、linker）/ `[workspace]` / `asconfig.json` 的 `transform` /
   `package.json` scripts / 夹带的 `node_modules`。
2. **隔离容器**（`Dockerfile.builder`）——兜底，不是第一层：
   `--network=none`、`--read-only`、`--cap-drop=ALL`、`no-new-privileges`、非 root、
   cgroup 限额、**不挂任何凭据**。入口 `build-rust.sh` 还会丢掉提交方夹带的 `target/` 与
   `.cargo/`，保证「从零重编译」而不是复用别人塞进来的产物。

## 一次性准备

```bash
docker build -f packages/wasm-algorithms/Dockerfile.builder \
  -t medtrust-wasm-builder:1.95.0 packages/wasm-algorithms
```

镜像 tag 跟随 `rust-toolchain.toml` 的 channel：**换工具链 = 换镜像 = 产物 SM3 改变 =
必须重走准入**。这是有意的（D-CN-5）。

## 构建一个待准入模块

```bash
cd packages/wasm-algorithms
node scripts/admit-cli.mjs \
  --source modules/disproportionality-rust \
  --analysis-type disproportionality \
  --emit-base64
```

输出一行 JSON：`{ok, sm3, sizeBytes, toolchain, sourceGate, staticGate, wasmBase64}`。
内部已经做了**双独立构建器对拍**（两个互不相干的临时目录各跑一遍，SM3 不一致即拒）。

### 构建环境变量

这些只被**构建工具链**读取，不进任何部署服务，所以不在 `DEPLOY.md` 登记。

| 变量 | 缺省 | 说明 |
|---|---|---|
| `WASM_BUILD_ISOLATION` | `container` | `container` = 在隔离镜像里编译；`host` = 直接在本机编译，**仅开发/CI 自证**，必须显式设置——代码不做静默回退（静默回退等于隔离没做） |
| `WASM_BUILDER_IMAGE` | `medtrust-wasm-builder:<channel>` | 覆盖构建器镜像；默认 tag 跟随 `rust-toolchain.toml` |

## 交给控制面入册

在**两台（或两次独立环境）**分别跑上面的命令，把两份产物交给控制面：

```bash
curl -X POST "$API/api/v1/module-admission/submissions/$ID/attest-build" \
  -H 'Content-Type: application/json' -d '{
    "reviewer": "reviewer-zhang",
    "builds": [
      {"builderId": "ci-runner-1", "wasmBase64": "...", "toolchain": {...}, "sourceGate": {...}},
      {"builderId": "ci-runner-2", "wasmBase64": "...", "toolchain": {...}, "sourceGate": {...}}
    ]
  }'
```

控制面随后**自己**：解码 → 各自算 SM3 → 要求全部相同 → 跑闸 1 → 平台 CA 对 SM3 签名 →
状态推进到 `built`。它**不采信**提交方声称的 SM3，也不要求信任构建环境的判断——
构建环境唯一提供的是「字节」，判定权全在控制面。

少于两份、或两份 `builderId` 相同 → 拒（一份不构成复现）。

## 验证隔离确实生效

```bash
# build.rs 必须在编译**之前**被拒，且从未被执行
TMP=$(mktemp -d); cp -R modules/disproportionality-rust/. "$TMP"/; rm -rf "$TMP/target"
cat > "$TMP/build.rs" <<'RS'
fn main() { std::fs::write("/tmp/EXFILTRATED.txt", "pwned").ok(); }
RS
rm -f /tmp/EXFILTRATED.txt
node -e "import('./scripts/admission.mjs').then(m=>m.reproduceAndGate('$TMP')).catch(e=>console.log(e.reason, e.message.split('\n')[0]))"
test ! -f /tmp/EXFILTRATED.txt && echo "✅ build.rs 从未执行"
rm -rf "$TMP"
```

## 已知边界

- **依赖必须为空**。任何依赖都可能自带 `build.rs` 或 proc-macro，会把审查面扩散到平台
  没审过的代码。需要依赖须走 vendored + 白名单，另立变更。
- 容器隔离的强度取决于宿主的 Docker 配置（用户命名空间、seccomp 默认 profile）。
  本环境应与生产控制面**网络隔离**，且不持有任何控制面凭据。
