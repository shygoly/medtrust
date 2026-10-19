#!/usr/bin/env python3
"""本机渲染别名：把「微软雅黑」映射到已安装的思源黑体（Noto Sans CJK SC）。

用途：PPTX 正文/标题字体是 `微软雅黑`。本机（macOS）没有该字体时，LibreOffice
会回退成宋体一类的衬线字，导出的 PDF 与在 PowerPoint / WPS 里看到的 PPTX 不一致。
本脚本生成两份**仅用于本机渲染**的字体文件（家族名改为 Microsoft YaHei / 微软雅黑），
装到 `~/Library/Fonts/`，让导出的 PDF 与 PPTX 观感一致（同为黑体）。

来源字体为 OFL 授权的 Noto Sans CJK SC（见 https://fonts.google.com/noto），
只改名称、不改字形，仅在当前机器上生效。撤销：删除下面两份文件即可。

运行：python3 scripts/local-font-alias-yahei.py
"""
from __future__ import annotations

import pathlib
import sys

from fontTools.ttLib import TTFont

FONT_DIR = pathlib.Path.home() / "Library" / "Fonts"
SOURCES = {
    "Regular": ["NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Medium.otf"],
    "Bold": ["NotoSansCJKsc-Bold.otf", "NotoSansCJKsc-Black.otf"],
}
FAMILY_EN = "Microsoft YaHei"
FAMILY_ZH = "微软雅黑"
PS_NAME = "MicrosoftYaHei"


def find_source(candidates):
    for c in candidates:
        p = FONT_DIR / c
        if p.exists():
            return p
    raise SystemExit(f"找不到来源字体：{candidates}（请先安装 Noto Sans CJK SC）")


def rename(src: pathlib.Path, dst: pathlib.Path, subfamily: str):
    f = TTFont(str(src))
    name = f["name"]
    for nid in (1, 2, 3, 4, 6, 16, 17, 18, 20, 21, 22):
        name.removeNames(nameID=nid)
    ps = PS_NAME if subfamily == "Regular" else f"{PS_NAME}-{subfamily}"
    sub_zh = "常规" if subfamily == "Regular" else "粗体"
    for plat, enc, lang, fam, sub in (
            (3, 1, 0x409, FAMILY_EN, subfamily),   # Windows / en-US
            (3, 1, 0x804, FAMILY_ZH, sub_zh),      # Windows / zh-CN
            (1, 0, 0, FAMILY_EN, subfamily),       # Mac Roman
    ):
        name.setName(fam, 1, plat, enc, lang)
        name.setName(sub, 2, plat, enc, lang)
        name.setName(f"{fam} {sub} ({subfamily})", 3, plat, enc, lang)
        name.setName(f"{FAMILY_EN} {subfamily}", 4, plat, enc, lang)
        name.setName(ps, 6, plat, enc, lang)
        name.setName(fam, 16, plat, enc, lang)
        name.setName(sub, 17, plat, enc, lang)
    try:
        f["CFF "].cff.fontNames[0] = ps
    except Exception:
        pass
    f.save(str(dst))
    return dst


def main():
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    made = []
    for sub, cands in SOURCES.items():
        src = find_source(cands)
        dst = FONT_DIR / f"{PS_NAME}-{sub}.otf"
        made.append(rename(src, dst, sub))
    for p in made:
        print("installed:", p)
    print("\n撤销：删除以上文件，或在系统「字体册」中移除 Microsoft YaHei。")


if __name__ == "__main__":
    sys.exit(main())
