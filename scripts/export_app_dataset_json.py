#!/usr/bin/env python3
"""Export a compact app JSON file from the app-ready CSV."""

from __future__ import annotations

import csv
import json
from pathlib import Path


SOURCE = Path("data/pint_prices_app_dataset.csv")
DESTINATION = Path("public/data/pint_prices_app_dataset.json")

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


def main() -> None:
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    dropped_oob = 0
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

    DESTINATION.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"Exported {len(rows)} rows to {DESTINATION}")
    print(f"Dropped {dropped_oob} row(s) outside Greater London bounds")


if __name__ == "__main__":
    main()
