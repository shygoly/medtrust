# -*- coding: utf-8 -*-
"""生成温州图灵可信数据空间合同套件（DOCX）。

用法：
    cd 合同/温州图灵-可信数据空间/_src
    python3 build.py
"""

from __future__ import annotations

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from docx_kit import ContractDoc  # noqa: E402
from content_main import build_main  # noqa: E402
from content_att1 import build_att1  # noqa: E402
from content_att2 import build_att2  # noqa: E402
from content_att3 import build_att3  # noqa: E402
from content_att4 import build_att4  # noqa: E402

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_DIR = os.path.join(BASE, "pdf")

PARTY_A = "苏州数说信息科技有限公司"
PARTY_B = "温州市图灵人工智能高等研究院"

MAIN_TITLE = ["可信数据空间", "联合建设与运营合作协议"]
MAIN_HEADER = "可信数据空间联合建设与运营合作协议"

ATTACHMENTS = [
    {
        "no": "附件一",
        "title": "技术功能与安全验收标准",
        "header": "附件一 · 技术功能与安全验收标准",
        "file": "02-附件一-技术功能与安全验收标准.docx",
        "build": build_att1,
    },
    {
        "no": "附件二",
        "title": "空间运营规则（试行版）",
        "header": "附件二 · 空间运营规则（试行版）",
        "file": "03-附件二-空间运营规则（试行版）.docx",
        "build": build_att2,
    },
    {
        "no": "附件三",
        "title": "数据权益配置附件",
        "header": "附件三 · 数据权益配置附件",
        "file": "04-附件三-数据权益配置附件.docx",
        "build": build_att3,
    },
    {
        "no": "附件四",
        "title": "技术服务合同",
        "header": "附件四 · 技术服务合同",
        "file": "05-附件四-技术服务合同.docx",
        "build": build_att4,
    },
]


def cover_main(c: ContractDoc, subtitle: str = ""):
    c.cover(
        kicker="合 同 文 本",
        title_lines=MAIN_TITLE,
        subtitle=subtitle,
        meta_lines=[
            f"甲方：{PARTY_A}",
            f"乙方：{PARTY_B}",
            "签订地点：浙江省温州市",
            "签订日期：＿＿＿＿年＿＿月＿＿日",
        ],
        doc_no="合同编号：＿＿＿＿＿＿＿＿＿＿",
    )


def cover_attachment(c: ContractDoc, item: dict):
    c.cover(
        kicker=item["no"],
        title_lines=[item["title"]],
        subtitle="《可信数据空间联合建设与运营合作协议》附件",
        meta_lines=[
            f"甲方：{PARTY_A}",
            f"乙方：{PARTY_B}",
            "签署日期：＿＿＿＿年＿＿月＿＿日",
        ],
        doc_no="版本：V1.0",
    )


def build_individual():
    paths = []

    c = ContractDoc(header_text=MAIN_HEADER)
    cover_main(c, subtitle="（含附件一至附件四）")
    build_main(c)
    path = os.path.join(BASE, "01-可信数据空间联合建设与运营合作协议.docx")
    c.save(path)
    paths.append(path)

    for item in ATTACHMENTS:
        c = ContractDoc(header_text=item["header"])
        cover_attachment(c, item)
        item["build"](c)
        path = os.path.join(BASE, item["file"])
        c.save(path)
        paths.append(path)

    return paths


def build_combined():
    c = ContractDoc(header_text="可信数据空间联合建设与运营合作协议（含附件一至四）")
    cover_main(c, subtitle="（含附件一至附件四）")
    build_main(c)

    for item in ATTACHMENTS:
        c.page_break()
        cover_attachment(c, item)
        c.page_break()
        item["build"](c)

    path = os.path.join(BASE, "06-合同合订本（含附件一至四）.docx")
    c.save(path)
    return path


def _pdf_font_variant(docx_path: str, tmp_dir: str) -> str:
    """复制一份 DOCX，把 Word 字体名替换为 LibreOffice 可识别的开源字体。

    原 DOCX 保留 宋体/黑体（Word 下正确）；PDF 只用这套替换后的副本，
    避免 macOS 上 LibreOffice 把中文回退成无衬线字体。
    """
    import zipfile

    font_map = {
        "宋体": "Noto Serif CJK SC",
        "黑体": "Noto Sans CJK SC",
        "楷体": "Noto Serif CJK SC",
    }
    src = zipfile.ZipFile(docx_path)
    out_path = os.path.join(tmp_dir, os.path.basename(docx_path))
    out = zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED)
    for item in src.infolist():
        data = src.read(item.filename)
        if item.filename.endswith(".xml"):
            for old, new in font_map.items():
                data = data.replace(old.encode("utf-8"), new.encode("utf-8"))
        out.writestr(item, data)
    out.close()
    src.close()
    return out_path


def to_pdf(docx_path: str):
    os.makedirs(PDF_DIR, exist_ok=True)
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        variant = _pdf_font_variant(docx_path, tmp)
        try:
            subprocess.run(
                ["soffice", "--headless", "--convert-to", "pdf", "--outdir", PDF_DIR, variant],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=240,
            )
            return os.path.join(PDF_DIR, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] PDF 转换失败：{docx_path} -> {exc}")
            return None


def main():
    paths = build_individual()
    combined = build_combined()
    paths.append(combined)
    print("已生成 DOCX：")
    for p in paths:
        print(" -", p)

    if "--no-pdf" not in sys.argv:
        print("\n正在转换 PDF ...")
        for p in paths:
            pdf = to_pdf(p)
            if pdf:
                print(" -", pdf)


if __name__ == "__main__":
    main()
