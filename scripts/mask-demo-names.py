#!/usr/bin/env python3
"""把截图/日志里出现的**演示机构名**替换为中性命名的副本（不覆盖原图）。

背景：演示环境用的机构名（华山 / 瑞金 / 疾控 demo 等）是合成数据里的占位机构，
对外材料里不应出现，以免被误读为真实部署机构。

做法：
  1. 用 tesseract（chi_sim+eng）取词级框；
  2. 命中「华山 / 瑞金 / huashan / ruijin / cdc-demo」的 token，按其**字符位置**算出子串框
     （等宽字体下 char_w ≈ 框宽 / token 长度，中文同样字宽一致），只遮这一小段；
  3. 用框外邻域的中位色填充补丁，再用同样的前景色在同一位置重绘中性名；
  4. 输出到 `screenshots-deck/`，并对输出**再 OCR 一次**断言零命中。

用法：python3 scripts/mask-demo-names.py
"""
from __future__ import annotations

import pathlib
import re
import sys

import pytesseract
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
EV = ROOT / "docs" / "申报书" / "证明材料"
OUTDIR = EV / "screenshots-deck"
TESS = ROOT / ".cache" / "tessdata"

# 机构名只出现在顶部标题带的图：直接裁掉标题带（比换字更干净，且不引入字体伪影）
CROP_TOP = {
    "15-场景6-跨中心比较效果-任务详情.png": 190,
    "16-场景7-联邦学习预测-任务详情.png": 190,
}

# 命中 → 中性替换（长名先替换，避免子串互相吃掉）
RULES = [
    (re.compile(r"dp-([a-z-]*?)huashan", re.I), lambda m: f"dp-{m.group(1)}siteA"),
    (re.compile(r"dp-([a-z-]*?)ruijin", re.I), lambda m: f"dp-{m.group(1)}siteB"),
    (re.compile(r"p[-_]?huashan", re.I), lambda m: "p-siteA"),
    (re.compile(r"p[-_]?ruijin", re.I), lambda m: "p-siteB"),
    (re.compile(r"huashan", re.I), lambda m: "siteA"),
    (re.compile(r"ruijin", re.I), lambda m: "siteB"),
    (re.compile(r"cdc[-_]?demo", re.I), lambda m: "siteC"),
    (re.compile(r"华山"), lambda m: "甲院"),
    (re.compile(r"瑞金"), lambda m: "乙院"),
]
HIT = re.compile(r"华山|瑞金|huashan|ruijin|cdc[-_]?demo", re.I)

ASCII_FONTS = ["/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/SFNSMono.ttf"]
CJK_FONTS = ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]


def load_font(paths, size):
    for p in paths:
        if pathlib.Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default()


def is_cjk(ch):
    return ord(ch) >= 0x2E80


def median_bg(im, box, pad=6):
    """取框外一圈的中位色作为背景（避开文字笔画）。"""
    x, y, w, h = box
    px = []
    for yy in range(max(0, y - pad - 3), min(im.height, y + h + pad + 3)):
        for xx in (max(0, x - pad - 3), min(im.width - 1, x + w + pad + 2)):
            px.append(im.getpixel((xx, yy)))
    for xx in range(max(0, x - pad - 3), min(im.width, x + w + pad + 3)):
        for yy in (max(0, y - pad - 3), min(im.height - 1, y + h + pad + 2)):
            px.append(im.getpixel((xx, yy)))
    if not px:
        return (255, 255, 255)
    return tuple(sorted(c[i] for c in px)[len(px) // 2] for i in range(3))


def fg_color(im, box):
    """框内与背景差异最大的常见色 = 文字色。"""
    x, y, w, h = box
    bg = median_bg(im, box)
    best, bestd = bg, -1
    from collections import Counter
    cnt = Counter()
    for yy in range(y, min(im.height, y + h)):
        for xx in range(x, min(im.width, x + w)):
            cnt[im.getpixel((xx, yy))] += 1
    for c, n in cnt.most_common(40):
        d = sum(abs(a - b) for a, b in zip(c, bg))
        if n >= max(2, (w * h) // 400) and d > bestd:
            best, bestd = c, d
    return best


def mask_image(path: pathlib.Path, out: pathlib.Path) -> int:
    im = Image.open(path).convert("RGB")
    cut = CROP_TOP.get(path.name)
    if cut:
        im = im.crop((0, cut, im.width, im.height))
    scale = 1.0 if im.width <= 2200 else 2200 / im.width
    small = im.resize((int(im.width * scale), int(im.height * scale))) if scale < 1 else im
    data = pytesseract.image_to_data(small, lang="chi_sim+eng", output_type=pytesseract.Output.DICT)

    patches = []
    for i, tok in enumerate(data["text"]):
        if not tok or not HIT.search(tok):
            continue
        repl = tok
        for pat, fn in RULES:
            if pat.search(repl):
                repl = pat.sub(fn, repl)
        if repl == tok:
            continue
        x = data["left"][i] / scale
        y = data["top"][i] / scale
        w = data["width"][i] / scale
        h = data["height"][i] / scale
        # 框可能只覆盖 token 的一部分（OCR 常见）：留出富余，整段重绘
        patches.append((int(x), int(y), int(x + w), int(y + h), repl))

    if not patches:
        out.parent.mkdir(parents=True, exist_ok=True)
        im.save(out)
        return 0

    d = ImageDraw.Draw(im)
    plan = []
    for (x0, y0, x1, y1, repl) in patches:
        box = (x0, y0, x1 - x0, y1 - y0)
        plan.append((box, repl, median_bg(im, box), fg_color(im, box)))   # 必须在填充前取色
    for box, repl, bg, fg in plan:
        x0, y0, w0, h0 = box
        d.rectangle([x0 - 2, y0 - 2, x0 + w0 + 2, y0 + h0 + 2], fill=bg)
    for box, repl, bg, fg in plan:
        x0, y0, w0, h0 = box
        cjk = any(is_cjk(c) for c in repl)
        size = max(10, int(h0 * 0.82))
        f = load_font(CJK_FONTS if cjk else ASCII_FONTS, size)
        d.text((x0, y0 + h0 * 0.06), repl, font=f, fill=fg)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    return len(patches)


def verify(path: pathlib.Path) -> list[str]:
    im = Image.open(path).convert("RGB")
    scale = 1.0 if im.width <= 2200 else 2200 / im.width
    small = im.resize((int(im.width * scale), int(im.height * scale))) if scale < 1 else im
    data = pytesseract.image_to_data(small, lang="chi_sim+eng", output_type=pytesseract.Output.DICT)
    return [t for t in data["text"] if t and HIT.search(t)]


def main() -> int:
    if not TESS.exists():
        print(f"缺少 OCR 数据目录 {TESS}", file=sys.stderr)
        return 2
    import os
    os.environ["TESSDATA_PREFIX"] = str(TESS)

    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    targets = sorted({p.name for p in list((EV / "screenshots").glob("*.png"))})
    if only:
        targets = [t for t in targets if any(o in t for o in only)]
        print(f"仅处理：{targets}")
    total, failed = 0, []
    for name in targets:
        src = EV / "screenshots" / name
        out = OUTDIR / name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(src.read_bytes())        # 一律从原图重建，避免叠加打码
        n = 0
        for _ in range(3):
            left = verify(out)
            if not left:
                break
            n += mask_image(out, out)
        left = verify(out)
        if n:
            total += n
            print(f"  {name[:46]:<48} 遮 {n} 处 → {'OK' if not left else f'残留 {left}'}")
            if left:
                failed.append(name)
        else:
            out.unlink(missing_ok=True)          # 无需打码的不留副本
    print(f"\n共处理 {total} 处；需打码文件 {len([f for f in OUTDIR.glob('*.png')])} 个，输出目录 {OUTDIR.relative_to(ROOT)}")
    print("复验：全部通过 ✓" if not failed else f"复验失败：{failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
