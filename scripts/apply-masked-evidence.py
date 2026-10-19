#!/usr/bin/env python3
"""把「演示机构名占位化」落到全部对外材料（在 mask-demo-names.py 跑完之后执行）。

做四件事：
  1. 把文件名里带机构名的截图改成占位名（screenshots/ 与 screenshots-deck/ 同步）；
  2. 更新 figures.json / README 里对这些文件的引用；
  3. 让 build-shenbao-book.py 生成的合订本**优先引用 screenshots-deck/ 下的打码副本**；
  4. 重新生成《入册编排方案》《申报材料合订本》并转 docx（A4）。

用法：先跑 scripts/mask-demo-names.py，再跑本脚本。
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SB = ROOT / "docs" / "申报书"
EV = SB / "证明材料"
RENAMES = {
    "04-连接器管理-华山医院.png": "04-连接器管理-甲院.png",
    "04-连接器管理-华山医院-整页.png": "04-连接器管理-甲院-整页.png",
}
BUILDER = ROOT / "scripts" / "build-shenbao-book.py"


def step1_rename() -> None:
    for old, new in RENAMES.items():
        for base in (EV / "screenshots", EV / "screenshots-deck"):
            src, dst = base / old, base / new
            if src.exists():
                if dst.exists():
                    dst.unlink()
                src.rename(dst)
                print(f"  改名 {base.name}/{old} → {new}")
        # 引用替换
        for f in [EV / "figures.json", EV / "README.md"]:
            if not f.exists():
                continue
            t = f.read_text(encoding="utf-8")
            if old in t:
                f.write_text(t.replace(old, new), encoding="utf-8")
                print(f"  更新引用 {f.name}")


def step2_builder_prefers_masked() -> None:
    s = BUILDER.read_text(encoding="utf-8")
    if "screenshots-deck" in s:
        print("  build-shenbao-book.py 已优先打码副本，跳过")
        return
    s = s.replace('''def md_link(f: dict) -> str:''',
'''def resolve(fig_file: str) -> str:
    """优先引用 screenshots-deck/ 下的打码副本（演示机构名已占位）。"""
    p = pathlib.Path(fig_file)
    masked = EV / "screenshots-deck" / p.name
    if masked.exists():
        return f"screenshots-deck/{p.name}"
    return fig_file


def md_link(f: dict) -> str:''')
    s = s.replace('''            out.append(f"**附图 {f['id']}**\\n\\n![](screenshots-x/{f['file']}){{width=15cm}}\\n\\n{f['caption']}\\n")''',
                  '''            out.append(f"**附图 {f['id']}**\\n\\n![](screenshots-x/{resolve(f['file'])}){{width=15cm}}\\n\\n{f['caption']}\\n")''')
    s = s.replace('''    book = book.replace("screenshots-x/../screenshots-redacted/", "证明材料/screenshots-redacted/")''',
                  '''    book = book.replace("screenshots-x/../screenshots-redacted/", "证明材料/screenshots-redacted/")''')
    BUILDER.write_text(s, encoding="utf-8")
    print("  build-shenbao-book.py：已改为优先 screenshots-deck/")


def step3_rebuild() -> None:
    subprocess.run([sys.executable, str(BUILDER)], cwd=ROOT, check=True)
    for name in ["证明材料/入册编排方案", "03-申报材料合订本（2026省级·带图）"]:
        subprocess.run(["pandoc", "-f", "markdown", "-t", "docx", "--wrap=none",
                        f"{name}.md", "-o", f"{name}.docx"], cwd=SB, check=True)
        # A4 + 页边距
        from docx import Document
        from docx.shared import Cm
        d = Document(SB / f"{name}.docx")
        for sec in d.sections:
            sec.page_width, sec.page_height = Cm(21), Cm(29.7)
            sec.top_margin = sec.bottom_margin = Cm(2.54)
            sec.left_margin = sec.right_margin = Cm(2.6)
        d.save(SB / f"{name}.docx")
        print(f"  重建 {name}.docx")


def main() -> int:
    print("① 文件名占位化")
    step1_rename()
    print("② 生成器改为优先打码副本")
    step2_builder_prefers_masked()
    print("③ 重新生成合订本与编排方案")
    step3_rebuild()
    return 0


if __name__ == "__main__":
    sys.exit(main())
