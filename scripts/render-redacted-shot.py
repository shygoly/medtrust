#!/usr/bin/env python3
"""用脱敏后的日志重渲染终端画面（申报材料用）。

与 `video/scripts/render-terminal-shot.mjs` 同风格（深色窗口 + 标题栏 + 行内高亮），
差别只有一处：渲染前按正则把基础设施标识（实例 ID / 公网·内网 IP / VPC ID）
替换成掩码形式，因此**不需要在图上手涂坐标**，也不会误遮证据内容。

用法：
  python3 scripts/render-redacted-shot.py <log> <out.png> --title '<标题>' [--cols 130] [--scale 2]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG = (11, 15, 20)
WIN = (15, 20, 27)
BAR = (26, 33, 43)
BAR_TEXT = (154, 167, 182)
TEXT = (215, 221, 229)
COMMENT = (125, 138, 153)
OK = (95, 211, 141)
WARN = (240, 179, 90)
HL = (108, 182, 255)

ASCII_FONTS = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFNSMono.ttf",
]
CJK_FONTS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
]

# 渲染前要打码的基础设施标识
MASK_RULES: list[tuple[str, str]] = [
    (r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "ip"),
    (r"\biZ[0-9a-z]{8,}Z\b", "host"),
    (r"\bi-[0-9a-z]{8,}\b", "inst"),
    (r"\bvpc-[0-9a-z]{8,}\b", "vpc"),
]


def mask_value(kind: str, token: str) -> str:
    if kind == "ip":
        return token.split(".")[0] + ".***.***.***"
    prefix = {"host": 5, "inst": 6, "vpc": 8}[kind]
    return token[:prefix] + "***" + ("Z" if kind == "host" else "")


def apply_masks(text: str, log: list[str]) -> tuple[list[str], int]:
    count = 0

    def sub(m: re.Match[str]) -> str:
        nonlocal count
        for pat, kind in MASK_RULES:
            if re.fullmatch(pat, m.group(0)):
                count += 1
                return mask_value(kind, m.group(0))
        return m.group(0)

    combined = "|".join(p for p, _ in MASK_RULES)
    out = [re.sub(combined, sub, line) for line in log]
    return out, count


def load_font(paths: list[str], size: int) -> ImageFont.FreeTypeFont:
    for p in paths:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    raise SystemExit(f"找不到可用字体：{paths}")


def is_cjk(ch: str) -> bool:
    o = ord(ch)
    return o >= 0x2E80


def draw_line(draw: ImageDraw.ImageDraw, x: int, y: int, line: str,
              fa: ImageFont.FreeTypeFont, fc: ImageFont.FreeTypeFont,
              scale: int) -> None:
    """逐字符绘制（ASCII 用等宽字体、CJK 用中文字体），实现终端对齐。"""
    if line.startswith("#"):
        color = COMMENT
    else:
        color = TEXT
    hl_spans = []
    for pat, col in (
        (r"✓|PASS|SUCCEEDED|PURGED|已登记|核验通过|审查通过|accepted|endorsed|active", OK),
        (r"WARN|RETRYING|失败|不可估|降级", WARN),
        (r"Intel TDX|tdx_guest|TDX quote|(?:sm3|SM3):[0-9a-f]{12,}", HL),
    ):
        for m in re.finditer(pat, line):
            hl_spans.append((m.start(), m.end(), col))

    cx = x
    for i, ch in enumerate(line):
        col = color
        for s, e, c in hl_spans:
            if s <= i < e:
                col = c
                break
        font = fc if is_cjk(ch) else fa
        draw.text((cx, y), ch, font=font, fill=col)
        cx += font.getlength(ch)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("out")
    ap.add_argument("--title", default=None)
    ap.add_argument("--cols", type=int, default=130)
    ap.add_argument("--scale", type=int, default=2)
    a = ap.parse_args()

    raw = Path(a.log).read_text(encoding="utf-8")
    raw = re.sub(r"\x1b\[[0-9;]*m", "", raw).rstrip()
    lines, masked = apply_masks(raw, raw.split("\n"))
    title = a.title or Path(a.log).name

    s = a.scale
    fa = load_font(ASCII_FONTS, 15 * s)
    fc = load_font(CJK_FONTS, 15 * s)
    fb = load_font(ASCII_FONTS, 13 * s)
    fbc = load_font(CJK_FONTS, 13 * s)

    line_h = round(23.25 * s)
    pad_l, pad_t, pad_b = 28 * s, 18 * s, 24 * s
    bar_h = 42 * s

    def width(text: str, cjk_font: ImageFont.FreeTypeFont, ascii_font: ImageFont.FreeTypeFont) -> float:
        return sum((cjk_font if is_cjk(c) else ascii_font).getlength(c) for c in text)

    content_w = max(
        [width(l, fc, fa) for l in lines] + [width(title, fbc, fb) + 60 * s]
    )
    win_w = int(content_w + pad_l * 2)
    win_h = int(bar_h + pad_t + len(lines) * line_h + pad_b)

    img = Image.new("RGB", (win_w, win_h), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, win_w, bar_h], fill=BAR)
    for i, col in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        cy = bar_h // 2
        cxx = 18 * s + i * 20 * s
        d.ellipse([cxx, cy - 6 * s, cxx + 12 * s, cy + 6 * s], fill=col)
    draw_line(d, 80 * s, (bar_h - 16 * s) // 2, title, fb, fbc, s)

    y = bar_h + pad_t
    for line in lines:
        draw_line(d, pad_l, y, line, fa, fc, s)
        y += line_h

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    img.save(a.out)
    print(f"✓ {a.out}（{len(lines)} 行，打码 {masked} 处，{img.size[0]}x{img.size[1]}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
