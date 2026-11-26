"""Remove personal text from imported and published price records."""

import re

EMAIL_RE = re.compile(
    r"[\w.+%-]+@[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\."
    r"(?!jpg\b|jpeg\b|png\b|webp\b|svg\b)[A-Za-z]{2,}\b(?![\w-]|\.[A-Za-z0-9-])",
    re.IGNORECASE,
)


def sanitize_record(record: dict[str, str]) -> dict[str, str]:
    if re.search(r"drinker\s*:", record.get("comment", ""), re.IGNORECASE):
        record["comment"] = ""
    return {
        field: EMAIL_RE.sub("", value)
        if field in {"comment", "note", "notes", "description", "data_quality_notes"}
        else value
        for field, value in record.items()
    }
