"""合并封面与正文 PDF，保留正文的书签（outline）与元数据。

WeasyPrint 不支持 page 计数器重置，因此封面与正文分两趟渲染；
pdfunite 会丢掉 Info 字典并留下不干净的 xref，故改用 pypdf。
"""

import sys

from pypdf import PdfReader, PdfWriter

cover_path, body_path, out_path = sys.argv[1:4]

writer = PdfWriter()
writer.append(cover_path)                 # 封面：无书签
writer.append(body_path, import_outline=True)

meta = PdfReader(body_path).metadata
if meta:
    writer.add_metadata({k: v for k, v in meta.items() if v})

with open(out_path, "wb") as fh:
    writer.write(fh)
