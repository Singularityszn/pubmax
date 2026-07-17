#!/usr/bin/env python3
"""Export a compact app JSON file from the app-ready CSV."""

from __future__ import annotations

import csv
import json
import subprocess
from pathlib import Path


SOURCE = Path("data/pint_prices_app_dataset.csv")
DESTINATION = Path("public/data/pint_prices_app_dataset.json")

# The scrape's borough labels are untrustworthy for rows whose ONLY borough
# signal is a pint-prices.com site anomaly (hundreds of pubs mass-tagged under
# Havering/Hillingdon/Redbridge — the F7 bug that labelled Prospect of Whitby,
# Wapping, as "Havering" and made Havering top /borough). For those rows we
# assign the borough geometrically: point-in-polygon against real Greater
# London borough boundaries (see BOROUGH_BOUNDARIES provenance). Points outside
# every polygon stay unclassified; nearest-vertex snapping is not evidence.
# Kept in lockstep with
# ANOMALY_BOROUGHS in scripts/build_app_dataset.py.
ANOMALY_BOROUGHS = {"Havering", "Hillingdon", "Redbridge"}

# Greater London bounding box. Rows with coordinates outside this box are a
# data-quality bug (a mis-geocoded pub, a lat/lng swap) — they scatter pins far
# off the map. Drop them at export and report the count. Kept in lockstep with
# scripts/validate-data.mjs and scripts/build_slim_index.mjs.
LAT_MIN, LAT_MAX = 51.26, 51.72
LON_MIN, LON_MAX = -0.55, 0.30


def in_london(lat: float, lng: float) -> bool:
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lng <= LON_MAX

FIELDS = [
    "app_price_id",
    "pub_name",
    "pint_name",
    "price_gbp",
    "price_text",
    "address",
    "latitude",
    "longitude",
    "boroughs_visible",
    "boroughs_raw_embedded_non_anomaly",
    "boroughs_raw_embedded_site_anomaly",
    "primary_borough",
    "rank_visible_borough",
    "estimated_average_price_text",
    "pub_url",
    "constructed_pub_url",
    "borough_urls",
    "phone_number",
    "email",
    "website",
    "booking_link",
    "image_url",
    "description",
    "comment",
    "food",
    "cocktails",
    "beer_garden",
    "live_sports",
    "live_music",
    "pub_quiz",
    "darts",
    "pool",
    "happy_hour",
    "karaoke",
    "cool",
    "source_datasets",
    "source_row_count",
    "has_visible_borough_row",
    "has_raw_embedded_map_row",
    "has_individual_pub_page_row",
    "is_clean_canonical_app_row",
    "data_quality_notes",
]


def parse_bool(value: str) -> bool:
    return value.strip().lower() == "true"


def parse_float(value: str) -> float | None:
    try:
        return round(float(value), 2)
    except ValueError:
        return None


def resolve_primary_borough(
    geometric_borough: str, record: dict[str, object]
) -> str:
    """Trust scraped boroughs unless the row's only signal is the site anomaly."""
    primary = str(record["primary_borough"]).strip()
    has_trusted_source = bool(
        str(record["boroughs_visible"]).strip()
        or str(record["boroughs_raw_embedded_non_anomaly"]).strip()
    )
    if has_trusted_source:
        return primary
    if primary and primary not in ANOMALY_BOROUGHS:
        return primary
    # Anomaly-only (or blank) borough: assign geometrically from coordinates.
    return geometric_borough


def classify_boroughs(records: list[dict[str, object]]) -> list[str]:
    points = [[record["latitude"], record["longitude"]] for record in records]
    result = subprocess.run(
        ["node", "scripts/classify_borough_points.mjs"],
        input=json.dumps(points),
        text=True,
        capture_output=True,
        check=True,
    )
    names = json.loads(result.stdout)
    if not isinstance(names, list) or len(names) != len(records):
        raise RuntimeError("Canonical borough classifier returned an invalid result")
    return [str(name) for name in names]


def main() -> None:
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    dropped_oob = 0
    reassigned = 0
    with SOURCE.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            record = {field: row.get(field, "") for field in FIELDS}
            record["price_gbp"] = parse_float(record["price_gbp"])
            record["latitude"] = float(record["latitude"])
            record["longitude"] = float(record["longitude"])
            # Bounds filter: drop rows with coordinates outside Greater London.
            if not in_london(record["latitude"], record["longitude"]):
                dropped_oob += 1
                continue
            record["source_row_count"] = int(float(record["source_row_count"] or 0))
            for field in [
                "has_visible_borough_row",
                "has_raw_embedded_map_row",
                "has_individual_pub_page_row",
                "is_clean_canonical_app_row",
            ]:
                record[field] = parse_bool(str(record[field]))
            rows.append(record)

    for record, geometric_borough in zip(rows, classify_boroughs(rows)):
        resolved = resolve_primary_borough(geometric_borough, record)
        if resolved != record["primary_borough"]:
            reassigned += 1
            record["primary_borough"] = resolved

    DESTINATION.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"Exported {len(rows)} rows to {DESTINATION}")
    print(f"Dropped {dropped_oob} row(s) outside Greater London bounds")
    print(f"Reassigned {reassigned} anomaly-borough row(s) via point-in-polygon")


if __name__ == "__main__":
    main()
