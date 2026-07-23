#!/usr/bin/env python3
"""Generate the packaged Soapy Panels legal PDFs from canonical Markdown."""

from __future__ import annotations

import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "docs" / "legal"
RUNTIME_DIR = ROOT / "app" / "renderer" / "docs" / "legal"
OUTPUT_DIR = ROOT / "output" / "pdf"
DOCUMENTS = (
    ("Soapy_Panels_Privacy_Policy.md", "Soapy_Panels_Privacy_Policy.pdf"),
    ("Soapy_Panels_Terms_of_Service.md", "Soapy_Panels_Terms_of_Service.pdf"),
)


def build_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            "LegalTitle",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=27,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#172033"),
            spaceAfter=18,
        )
    )
    styles.add(
        ParagraphStyle(
            "LegalHeading",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=17,
            textColor=colors.HexColor("#244b7a"),
            spaceBefore=11,
            spaceAfter=6,
            keepWithNext=True,
        )
    )
    styles.add(
        ParagraphStyle(
            "LegalBody",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#202735"),
            spaceAfter=7,
        )
    )
    styles.add(
        ParagraphStyle(
            "LegalStatus",
            parent=styles["BodyText"],
            fontName="Helvetica-Oblique",
            fontSize=9,
            leading=13,
            textColor=colors.HexColor("#6a3d00"),
            backColor=colors.HexColor("#fff4dd"),
            borderColor=colors.HexColor("#edc36c"),
            borderWidth=0.5,
            borderPadding=7,
            spaceAfter=12,
        )
    )
    return styles


def inline_markup(text: str) -> str:
    value = escape(text)
    value = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", value)
    return value


def markdown_story(markdown: str):
    styles = build_styles()
    story = []
    paragraph_lines: list[str] = []

    def flush_paragraph():
        if not paragraph_lines:
            return
        text = " ".join(line.strip() for line in paragraph_lines)
        style = styles["LegalStatus"] if text.startswith("Status:") else styles["LegalBody"]
        story.append(Paragraph(inline_markup(text), style))
        paragraph_lines.clear()

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        if not line:
            flush_paragraph()
            continue
        if line.startswith("# "):
            flush_paragraph()
            story.append(Spacer(1, 0.08 * inch))
            story.append(Paragraph(inline_markup(line[2:]), styles["LegalTitle"]))
        elif line.startswith("## "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line[3:]), styles["LegalHeading"]))
        elif line.startswith("- "):
            flush_paragraph()
            story.append(Paragraph("&#8226; " + inline_markup(line[2:]), styles["LegalBody"]))
        else:
            paragraph_lines.append(line)
    flush_paragraph()
    return story


def footer(canvas, document):
    canvas.saveState()
    width, _height = LETTER
    canvas.setStrokeColor(colors.HexColor("#d9dee8"))
    canvas.line(0.7 * inch, 0.58 * inch, width - 0.7 * inch, 0.58 * inch)
    canvas.setFillColor(colors.HexColor("#657087"))
    canvas.setFont("Helvetica", 8)
    canvas.drawString(0.7 * inch, 0.39 * inch, "Soapy Panels")
    canvas.drawRightString(width - 0.7 * inch, 0.39 * inch, f"Page {document.page}")
    canvas.restoreState()


def generate(source_name: str, output_name: str):
    source = SOURCE_DIR / source_name
    markdown = source.read_text(encoding="utf-8")
    title = markdown.splitlines()[0].removeprefix("# ").strip()
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for destination in (RUNTIME_DIR / output_name, OUTPUT_DIR / output_name):
        document = SimpleDocTemplate(
            str(destination),
            pagesize=LETTER,
            rightMargin=0.72 * inch,
            leftMargin=0.72 * inch,
            topMargin=0.62 * inch,
            bottomMargin=0.72 * inch,
            title=title,
            author="Soapy Panels",
            subject="Soapy Panels legal information",
        )
        document.build(markdown_story(markdown), onFirstPage=footer, onLaterPages=footer)
        print(f"Wrote {destination}")


def main():
    for source_name, output_name in DOCUMENTS:
        generate(source_name, output_name)


if __name__ == "__main__":
    main()
