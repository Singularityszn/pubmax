#!/usr/bin/env python3
"""Export a compact app JSON file from the app-ready CSV."""

from __future__ import annotations

import csv
import json
import subprocess
from pathlib import Path


SOURCE = Path("data/pint_prices_app_dataset.csv")
DESTINATION = Path("public/data/pint_prices_app_dataset.json")

# The scrape's borough labels are untrustworthy — not just for the F7 site
# anomaly (hundreds of pubs mass-tagged under Havering/Hillingdon/Redbridge,
# which put Prospect of Whitby, Wapping, in "Havering") but systematically:
# #308's coverage report found the stored label disagrees with the pin's own
# geometry for hundreds of core pubs (Camden 89, City of London 77 at the venue
# level), e.g. Upper Street N1 pubs tagged "Camden" though they are the spine of
# Islington, or Bankside/Butlers Wharf pubs tagged "City of London" though they
# sit south of the river in Southwark. Geometry is the single source of truth:
# `primary_borough` is assigned by point-in-polygon against real Greater London
# borough boundaries (see data/london_boroughs_simplified.json provenance)
# whenever the pin falls inside a borough polygon. Only points OUTSIDE every
# polygon fall back to the scraped label — nearest-vertex snapping is not
# evidence. ANOMALY_BOROUGHS is retained for documentation/lockstep with
# scripts/build_app_dataset.py; geometry now overrides every borough, anomaly or
# not. The same repair is applied to the committed dataset (which carries
# post-export gazetteer rows) by scripts/repair_borough_labels.mjs.
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
    """Geometry is authoritative; the scraped label is only a last resort.

    Point-in-polygon against real borough boundaries wins whenever the pin lands
    inside a borough (the scraped source labels are systematically wrong — see
    the ANOMALY_BOROUGHS note above). Only when the classifier returns "" (the
    point is outside every polygon, so there is no geometric evidence) do we keep
    the scraped `primary_borough` rather than blank it out.
    """
    if geometric_borough:
        return geometric_borough
    return str(record["primary_borough"]).strip()


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
