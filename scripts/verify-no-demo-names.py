#!/usr/bin/env python3
"""对外材料终检：文字 + **内嵌图片** 双查。

查两类问题：
  A. 演示机构名（华山 / 瑞金 / huashan / ruijin / cdc-demo）——不应出现在任何对外材料；
  B. 申报口径词（申报 / 试点 / 推荐单位 / 附件 / 评审 / 考核 / 验收）——合作沟通材料不应出现。

图片检测用 tesseract（chi_sim+eng，OCR 数据在 `.cache/tessdata`），因此**图片里的字也查得到**。

用法：python3 scripts/verify-no-demo-names.py [文件 ...]
      缺省检查 PPT + 合订本 + 两份报送版。
"""
from __future__ import annotations

import io
import os
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
os.environ.setdefault("TESSDATA_PREFIX", str(ROOT / ".cache" / "tessdata"))

import pytesseract                      # noqa: E402
from PIL import Image                   # noqa: E402

NAME = re.compile(r"华山|瑞金|huashan|ruijin|cdc[-_]?demo", re.I)
DECL = re.compile(r"申报|试点|推荐单位|申报书|附件|评审|考核|验收|报送")

TARGETS = [
    "pitch/MedTrust-医疗可信数据空间-合作沟通.pptx",
    "docs/申报书/03-申报材料合订本（2026省级·带图）.docx",
    "docs/申报书/01-报送版-国家行业模板.docx",
    "docs/申报书/02-报送版-2026省级模板.docx",
]


def ocr_hits(data: bytes) -> list[str]:
    im = Image.open(io.BytesIO(data)).convert("RGB")
    sc = 1.0 if im.width <= 2200 else 2200 / im.width
    sm = im.resize((int(im.width * sc), int(im.height * sc))) if sc < 1 else im
    d = pytesseract.image_to_data(sm, lang="chi_sim+eng", output_type=pytesseract.Output.DICT)
    return [t for t in d["text"] if t and NAME.search(t)]


def check(path: pathlib.Path) -> bool:
    print(f"\n=== {path.name} ===")
    if not path.exists():
        print("  缺失"); return False
    ok = True
    with zipfile.ZipFile(path) as z:
        media = [n for n in z.namelist() if re.search(r"(word/media|ppt/media)/", n)]
        bad_imgs = []
        for n in media:
            hits = ocr_hits(z.read(n))
            if hits:
                bad_imgs.append((n, hits[:3]))
        print(f"  内嵌图片 {len(media)} 张 → 命中机构名 {len(bad_imgs)} 张" + ("" if not bad_imgs else f" ✗ {bad_imgs[:3]}"))
        ok &= not bad_imgs
        # 文字（docx: word/document.xml；pptx: 各 slide XML）
        texts = [n for n in z.namelist() if re.match(r"(word/document|ppt/slides/slide\d+)\.xml$", n)]
        blob = "".join(z.read(n).decode("utf-8", "ignore") for n in texts)
        plain = re.sub(r"<[^>]+>", "", blob)
        names = NAME.findall(plain)
        decl = sorted(set(DECL.findall(plain)))
        print(f"  文字机构名 {len(names)} 处" + ("" if not names else f" ✗ {names[:5]}"))
        is_deck = path.suffix.lower() == ".pptx"      # 申报口径词只约束合作沟通材料
        if is_deck:
            print(f"  申报口径词 {decl if decl else '无 ✓'}")
        elif decl:
            print(f"  申报口径词 {len(decl)} 类（本件为申报材料，属预期）")
        ok &= not names and (not decl if is_deck else True)
    print("  → " + ("通过 ✓" if ok else "有问题 ✗"))
    return ok


def main() -> int:
    files = [pathlib.Path(a) for a in sys.argv[1:]] or [ROOT / t for t in TARGETS]
    results = [check(f) for f in files]
    print(f"\n总计 {sum(results)}/{len(results)} 通过")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
