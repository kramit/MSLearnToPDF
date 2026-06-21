import json
import re
import sys
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 3:
        fail("Usage: validate_pdf.py <pdf> <extraction-report.json>")

    pdf_path = Path(sys.argv[1])
    report_path = Path(sys.argv[2])
    report = json.loads(report_path.read_text(encoding="utf-8"))

    reader = PdfReader(str(pdf_path))
    if not reader.pages:
        fail("PDF has no pages")

    with pdfplumber.open(pdf_path) as pdf:
        page_text = [(page.extract_text() or "") for page in pdf.pages]

    full_text = "\n".join(page_text)
    normalized_text = re.sub(r"\s+", " ", full_text)
    units = [
        unit
        for module in report["modules"]
        for unit in module["units"]
    ]
    required = [
        report["learningPath"]["title"],
        "Source and attribution",
    ] + [module["title"] for module in report["modules"]] + [
        unit["title"] for unit in units
    ]
    if report["totals"].get("answerCount", 0) > 0:
        required.append("Assessment answer key")

    missing = [
        text for text in required
        if re.sub(r"\s+", " ", text) not in normalized_text
    ]
    if missing:
        fail(f"Required text missing: {missing}")

    blank_pages = [
        index + 1 for index, text in enumerate(page_text) if len(text.strip()) < 20
    ]
    if blank_pages:
        fail(f"Blank or nearly blank pages: {blank_pages}")

    cursor = 0
    for unit in units:
        title = re.sub(r"\s+", " ", unit["title"])
        position = normalized_text.find(title, cursor)
        if position < 0:
            fail(f"Unit title not found in source order: {unit['title']}")
        cursor = position + len(title)

    result = {
        "pdf": str(pdf_path),
        "pages": len(reader.pages),
        "modules_verified": len(report["modules"]),
        "units_verified": len(units),
        "blank_pages": blank_pages,
        "status": "pass",
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
