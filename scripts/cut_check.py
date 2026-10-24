#!/usr/bin/env python3
"""Score a recorded battle-test run. This command makes no network requests.

The original external scorer is unavailable. This replacement reports only
the checks and artifacts supplied by the caller. See docs/BATTLE_TEST.md.
"""

import argparse
import json
import re
from pathlib import Path


def read_json(root, name):
    path = root / name
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def browser_bar(root, checks, bar):
    results = []
    for device in ("desktop", "mobile"):
        check = checks.get(f"{bar}.{device}")
        if not isinstance(check, dict):
            results.append("UNVERIFIED")
            continue
        if check.get("passed") is False:
            results.append("FAIL")
            continue
        evidence = check.get("evidence", [])
        complete = bool(evidence) and isinstance(evidence, list)
        for name in evidence if complete else []:
            if not isinstance(name, str):
                complete = False
                break
            path = (root / name).resolve()
            if not path.is_relative_to(root.resolve()) or not path.is_file():
                complete = False
                break
        expected = [1280, 800] if device == "desktop" else [390, 844]
        results.append("PASS" if check.get("passed") is True and complete
                       and check.get("viewport") == expected else "UNVERIFIED")
    return "FAIL" if "FAIL" in results else "UNVERIFIED" if "UNVERIFIED" in results else "PASS"


def score(root, expected_sha=None):
    manifest = read_json(root, "browser-checks.json") or {}
    checks = manifest.get("checks", {})
    version = read_json(root, "api-version.json")
    drops = read_json(root, "api-pint-drops.json")
    out = read_json(root, "api-out.json")
    bars = {name: browser_bar(root, checks, name) for name in ("map", "pint", "tonight")}
    identity = "UNVERIFIED"
    if expected_sha and isinstance(version, dict):
        identity = "PASS" if version.get("gitCommitSha") == expected_sha and version.get("deploymentId") else "FAIL"
    if not isinstance(drops, dict) or not isinstance(drops.get("drops"), list):
        if bars["pint"] != "FAIL":
            bars["pint"] = "UNVERIFIED"
    matched = None
    raw_count = None
    if isinstance(out, dict) and isinstance(out.get("events"), list):
        events = out["events"]
        raw_count = len(events)
        # /api/out already applies the requested time window and its pub index.
        # An unmatched concert never contributes to the pub result count.
        matched = sum(isinstance(row, dict)
                      and bool(re.fullmatch(r"venue-[a-zA-Z0-9-]+", row.get("venueId") or ""))
                      for row in events)
        if (out.get("listingsStatus", out.get("status")) != "ready"
                or out.get("venueMatch") != "ready"):
            bars["tonight"] = "FAIL"
    elif bars["tonight"] != "FAIL":
        bars["tonight"] = "UNVERIFIED"
    statuses = [identity, *bars.values()]
    return {
        "schemaVersion": 1,
        "identity": identity,
        "bars": bars,
        "tonight": {"rawRows": raw_count, "pubMatchedRows": matched,
                    "countBasis": "pub-matched API rows, before display grouping"},
        "overall": "FAIL" if "FAIL" in statuses else "UNVERIFIED" if "UNVERIFIED" in statuses else "PASS",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    parser.add_argument("--expected-sha")
    args = parser.parse_args()
    if not args.evidence_dir.is_dir():
        parser.error("The evidence directory does not exist.")
    try:
        result = score(args.evidence_dir, args.expected_sha)
    except (ValueError, TypeError, AttributeError, OSError) as error:
        parser.exit(2, f"Invalid evidence: {error}\n")
    output = args.evidence_dir / "cut-check.json"
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result["overall"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
