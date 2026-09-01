#!/usr/bin/env python3
"""
Stage 1 of the submission build: docs/ANSWERS.md -> styled, print-ready HTML.

markdown-it-py (GFM tables) + Pygments syntax highlighting + print CSS.
Stage 2 (docs/build-pdf.mjs) renders it to PDF with Playwright.

Usage: python3 docs/build-pdf.py && node docs/build-pdf.mjs
"""
import html
import pathlib
import re
import sys

from markdown_it import MarkdownIt
from pygments import highlight as pyg_highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name

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


def highlight_code(code: str, lang: str, _attrs) -> str:
    """Pygments where we know the language, plain <pre> otherwise (ASCII diagrams)."""
    if not lang:
        return f'<pre class="plain"><code>{html.escape(code)}</code></pre>'
    try:
        lexer = get_lexer_by_name(lang, stripnl=False)
    except Exception:
        return f'<pre class="plain"><code>{html.escape(code)}</code></pre>'
    return pyg_highlight(code, lexer, HtmlFormatter(nowrap=False, cssclass="hl"))


CSS = """
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }

:root {
  --ink: #14213d; --body: #23303f; --muted: #5b6b7f;
  --line: #d9e0e8; --accent: #2f5fd0; --code-bg: #f6f8fb;
  --th-bg: #eef2f7;
}

* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: "Charter", "Georgia", "Iowan Old Style", serif;
  font-size: 10.2pt; line-height: 1.52; color: var(--body);
  margin: 0; hyphens: none;
}

/* ---------- title page ---------- */
.cover { height: 245mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.cover .rule { width: 54px; height: 4px; background: var(--accent); margin-bottom: 26px; }
.cover h1 { font-size: 27pt; line-height: 1.15; margin: 0 0 10px; color: var(--ink); letter-spacing: -.3px; border: 0; padding: 0; }
.cover .subtitle { font-size: 13pt; color: var(--muted); margin: 0 0 40px; font-style: italic; }
.cover dl { margin: 0; display: grid; grid-template-columns: 88px 1fr; row-gap: 7px; column-gap: 14px; font-size: 10pt; }
.cover dt { color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-size: 8pt; padding-top: 2px; font-family: -apple-system, "Helvetica Neue", sans-serif; }
.cover dd { margin: 0; color: var(--ink); }
.cover a { color: var(--accent); text-decoration: none; word-break: break-all; }

/* ---------- headings ---------- */
h1 {
  font-size: 17pt; color: var(--ink); margin: 0 0 16px;
  padding-bottom: 7px; border-bottom: 2.5px solid var(--accent);
  page-break-before: always; page-break-after: avoid; letter-spacing: -.2px;
}
h1:first-of-type { page-break-before: avoid; }
h2 { font-size: 13pt; color: var(--ink); margin: 24px 0 9px; page-break-after: avoid; }
h3 { font-size: 11pt; color: var(--ink); margin: 18px 0 7px; page-break-after: avoid; }
h4 { font-size: 10.2pt; color: var(--muted); margin: 14px 0 6px; page-break-after: avoid;
     text-transform: uppercase; letter-spacing: .06em; font-family: -apple-system, sans-serif; }

p { margin: 0 0 10px; orphans: 3; widows: 3; }
strong { color: var(--ink); font-weight: 700; }
em { font-style: italic; }
a { color: var(--accent); }
hr { border: 0; border-top: 1px solid var(--line); margin: 22px 0; }

ul, ol { margin: 0 0 12px; padding-left: 20px; }
li { margin-bottom: 5px; }
li > p { margin-bottom: 5px; }

/* ---------- code ---------- */
code {
  font-family: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 8.4pt; background: var(--code-bg); padding: 1px 4px;
  border-radius: 3px; color: #1c3f6e;
}
pre {
  background: var(--code-bg); border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: 4px; padding: 10px 12px; margin: 0 0 13px; overflow-x: auto;
  /* Several samples are longer than a page, so allow breaks rather than
     leaving large gaps; tables below still avoid splitting. */
  page-break-inside: auto;
}
pre code, pre.plain code { background: none; padding: 0; font-size: 7.9pt; line-height: 1.45; color: #1f2d3d; }
pre.plain code { font-size: 7.6pt; }
/* ---------- tables ---------- */
table {
  width: 100%; border-collapse: collapse; margin: 0 0 15px;
  font-size: 8.6pt; page-break-inside: avoid;
  font-family: -apple-system, "Helvetica Neue", sans-serif;
}
th, td { border: 1px solid var(--line); padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: var(--th-bg); color: var(--ink); font-weight: 700; }
tr:nth-child(even) td { background: #fbfcfe; }
td code, th code { font-size: 7.8pt; }

blockquote { margin: 0 0 12px; padding: 8px 14px; border-left: 3px solid var(--line); color: var(--muted); }
"""


def main() -> int:
    if not SRC.exists():
        print(f"missing {SRC}", file=sys.stderr)
        return 1

    meta, body = split_front_matter(SRC.read_text())

    # linkify is part of the gfm-like preset but needs an extra package; URLs in
    # this document are already explicit links or inline code, so it is off.
    md = MarkdownIt(
        "gfm-like",
        {"highlight": highlight_code, "html": True, "typographer": True, "linkify": False},
    )
    content = md.render(body)

    cover = f"""
    <section class="cover">
      <div class="rule"></div>
      <h1>{html.escape(meta.get('title', 'Technical Assessment'))}</h1>
      <p class="subtitle">{html.escape(meta.get('subtitle', ''))}</p>
      <dl>
        <dt>Candidate</dt><dd>{html.escape(meta.get('author', ''))}</dd>
        <dt>Date</dt><dd>{html.escape(meta.get('date', ''))}</dd>
        <dt>Code</dt><dd><a href="{meta.get('repo', '')}">{html.escape(meta.get('repo', ''))}</a></dd>
      </dl>
    </section>
    """

    pygments_css = HtmlFormatter(cssclass="hl").get_style_defs(".hl")
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{html.escape(meta.get('title', 'Assessment'))}</title>
<style>{CSS}
{pygments_css}
.hl {{ background: var(--code-bg); }}
.hl pre {{ margin: 0; border: 0; padding: 0; background: none; }}
</style></head>
<body>{cover}{content}</body></html>"""

    OUT_HTML.write_text(page)
    print(f"wrote {OUT_HTML.relative_to(ROOT)} ({len(page) // 1024} KB)")

    print("next: node docs/build-pdf.mjs  (renders the PDF via Playwright)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
