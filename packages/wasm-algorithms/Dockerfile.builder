# third-party-module-admission 闸 2 —— **隔离构建器**镜像。
#
# 为什么要单独一个镜像：`cargo build` 会执行第三方的 `build.rs` 与 proc-macro，
# 那是一个**完整的代码执行点**，而闸 1 只看产物 `.wasm`、闸 3 只看运行期 —— 编译期
# 不被任何一道闸覆盖。把它放进对外提供 HTTP 的控制面 api 容器里，等于把准入闸最薄弱
# 的一环安在最不该安的地方。所以编译**只在本镜像里发生**，api 容器不装编译器。
#
# 本镜像刻意只做一件事：吃只读源码、吐 `.wasm` 字节。
#   · 不含任何控制面凭据（CA 私钥、DB、token 一概不挂）；
#   · 运行时 `--network=none`（wasm32 target 在**构建镜像时**装好，运行期不需要网络）；
#   · `--read-only` + tmpfs、非 root、`cap-drop=ALL`、`no-new-privileges`、cgroup 限额；
#   · SM3 计算、双构建器对拍、闸 1 静态校验都**留在容器外**的可信代码里 ——
#     容器只负责「把不可信的编译过程关起来」，不负责任何判定。
FROM rust:1.95.0-slim-bookworm

# wasm32 target 在镜像构建期装好，运行期即可彻底断网。
RUN rustup target add wasm32-unknown-unknown \
    && rm -rf /usr/local/cargo/registry

# 非 root 运行；cargo 的可变状态全部落在 tmpfs 上（见 entrypoint 的 CARGO_HOME）。
RUN useradd -u 10002 -m -s /usr/sbin/nologin builder

COPY build-rust.sh /usr/local/bin/build-rust.sh
RUN chmod 0555 /usr/local/bin/build-rust.sh

USER 10002:10002
WORKDIR /src
ENTRYPOINT ["/usr/local/bin/build-rust.sh"]
