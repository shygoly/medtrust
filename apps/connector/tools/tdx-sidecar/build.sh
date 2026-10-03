#!/usr/bin/env bash
# 在 TDVM / 校验机上构建 tdx-sidecar（tdx-attestation-pilot 任务 1.2 的构建配方）。
#
# 依赖：Go ≥ 1.20；anolis/go-tdx-guest 源码树（含 tools/tdx-lab 的 ioctl provider，
# 以及 go.mod 里的 github.com/tjfoc/gmsm）。本脚本把 main.go 放进该源码树的 tools/ 下构建，
# ioctl provider 直接取自同一仓库的 tools/tdx-lab——不在本仓复制第三方代码。
#
#   GO_TDX_GUEST=/root/go-tdx-guest ./build.sh        # 产物：/usr/local/bin/tdx-sidecar
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
REPO="${GO_TDX_GUEST:-/root/go-tdx-guest}"
OUT="${OUT:-/usr/local/bin/tdx-sidecar}"

test -f "$REPO/tools/tdx-lab/provider_ioctl_linux.go" || {
  echo "找不到 $REPO/tools/tdx-lab/provider_ioctl_linux.go（需要 anolis/go-tdx-guest）" >&2
  exit 1
}

DST="$REPO/tools/tdx-sidecar"
mkdir -p "$DST"
cp "$SRC/main.go" "$DST/main.go"
cp "$REPO/tools/tdx-lab/provider_ioctl_linux.go" "$DST/provider_ioctl_linux.go"

cd "$REPO"
CGO_ENABLED=0 go build -trimpath -o "$OUT" ./tools/tdx-sidecar
echo "built $OUT"
echo "go-tdx-guest $(git -C "$REPO" rev-parse --short HEAD)  sha256 $(sha256sum "$OUT" | cut -d' ' -f1)"
