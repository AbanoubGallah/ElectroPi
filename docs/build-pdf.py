#!/usr/bin/env python3
"""
docs/ANSWERS.md -> print-ready HTML. Stage 2 (build-pdf.mjs) makes the PDF.

Usage: python3 docs/build-pdf.py && node docs/build-pdf.mjs
"""
import html
import pathlib
import re
import sys

from markdown_it import MarkdownIt

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "ANSWERS.md"
OUT_HTML = ROOT / "docs" / "ANSWERS.html"


def split_front_matter(text: str) -> tuple[dict[str, str], str]:
    match = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not match:
        return {}, text
    meta = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip()
    return meta, text[match.end():]


def plain_code(code: str, _lang: str, _attrs) -> str:
    """Monochrome code. Short blocks are kept whole so a diagram is not split
    across a page; long ones are allowed to break."""
    keep = "" if code.count("\n") > 22 else ' class="keep"'
    return f"<pre{keep}><code>{html.escape(code)}</code></pre>"


CSS = """
@page { size: A4; margin: 20mm 18mm 16mm 18mm; }

html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 10.8pt; line-height: 1.45; color: #000; margin: 0;
}

/* title block: a heading and a few lines, as in a word processor */
.titleblock { margin-bottom: 26px; padding-bottom: 14px; border-bottom: 1px solid #999; }
.titleblock h1 { font-size: 17pt; margin: 0 0 3px; padding: 0; border: 0; }
.titleblock .sub { font-size: 11.5pt; margin: 0 0 12px; color: #333; }
.titleblock .meta { font-size: 10pt; line-height: 1.6; }
.titleblock .meta span { color: #555; }

h1 { font-size: 14.5pt; margin: 26px 0 10px; page-break-after: avoid; }
h2 { font-size: 12pt; margin: 20px 0 8px; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 16px 0 6px; page-break-after: avoid; }

p { margin: 0 0 9px; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 10px; padding-left: 22px; }
li { margin-bottom: 4px; }
hr { border: 0; border-top: 1px solid #ccc; margin: 18px 0; }
a { color: #000; }

code {
  font-family: Menlo, Consolas, "Courier New", monospace;
  font-size: 9pt;
}
pre {
  background: #f4f4f4; border: 1px solid #ddd; padding: 8px 10px;
  margin: 0 0 11px; page-break-inside: auto;
}
pre.keep { page-break-inside: avoid; }
pre code { font-size: 8.2pt; line-height: 1.4; }

table {
  border-collapse: collapse; margin: 0 0 12px; font-size: 9.2pt;
  page-break-inside: avoid;
}
th, td { border: 1px solid #aaa; padding: 4px 7px; text-align: left; vertical-align: top; }
th { background: #eee; font-weight: bold; }
td code, th code { font-size: 8.4pt; }
"""


def main() -> int:
    if not SRC.exists():
        print(f"missing {SRC}", file=sys.stderr)
        return 1

    meta, body = split_front_matter(SRC.read_text())

    md = MarkdownIt(
        "gfm-like",
        {"highlight": plain_code, "html": True, "typographer": False, "linkify": False},
    )
    content = md.render(body)

    titleblock = f"""
    <div class="titleblock">
      <h1>{html.escape(meta.get('title', ''))}</h1>
      <p class="sub">{html.escape(meta.get('subtitle', ''))}</p>
      <div class="meta">
        {html.escape(meta.get('author', ''))}<br>
        <span>{html.escape(meta.get('date', ''))}</span><br>
        <span>Code:</span> {html.escape(meta.get('repo', ''))}
      </div>
    </div>
    """

    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{html.escape(meta.get('title', 'Assessment'))}</title>
<style>{CSS}</style></head>
<body>{titleblock}{content}</body></html>"""

    OUT_HTML.write_text(page)
    print(f"wrote docs/{OUT_HTML.name} ({len(page) // 1024} KB)")
    print("next: node docs/build-pdf.mjs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
