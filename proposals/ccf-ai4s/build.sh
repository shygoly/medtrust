#!/usr/bin/env bash
# 构建 CCF 政策建议提案 PDF。
#
# 封面与正文分两趟渲染再合并：WeasyPrint 不支持 page 计数器重置，
# 拆开渲染才能让正文页码从 1 起跳、封面不带页码。
#
# 依赖：uv（https://docs.astral.sh/uv/，首次运行自动拉取 weasyprint 70 与 pypdf）
set -euo pipefail

cd "$(dirname "$0")"
OUT="${1:-../../CCF-可信科学数据空间-支撑AI4S提案2（公文版）.pdf}"
mkdir -p build "$(dirname "$OUT")"

printf '.body { display: none }' > build/cover-only.css
printf '.cover { display: none }' > build/body-only.css

uvx --from weasyprint weasyprint proposal.html build/cover.pdf -s build/cover-only.css
uvx --from weasyprint weasyprint proposal.html build/body.pdf -s build/body-only.css

uvx --from pypdf python merge.py build/cover.pdf build/body.pdf "$OUT"
echo "built: $(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
