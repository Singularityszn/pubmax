#!/usr/bin/env python3
"""Build one deduped, app-ready CSV from the extracted Pint Prices files."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

import pandas as pd


DATA = Path("data")
ANOMALY_BOROUGHS = {"Havering", "Hillingdon", "Redbridge"}
LONDON_LAT_MIN, LONDON_LAT_MAX = 51.26, 51.72
LONDON_LON_MIN, LONDON_LON_MAX = -0.55, 0.30
DECISION_SCRIPT = Path(__file__).resolve().with_name(
    "resolve_postcode_coordinate_decisions.mjs"
)
DECISION_INPUT_FILES = [
    DATA / "pint_prices_canonical_enriched.csv",
    DATA / "borough_embedded_pint_prices.csv",
    DATA / "pub_page_pint_prices.csv",
    DATA / "osm" / "uk" / "uk_osm_pubs.json",
    DATA / "postcode_coordinate_corrections.json",
    DATA / "postcode_coordinate_quarantine.json",
    DATA / "postcode_coordinate_exceptions.json",
]
DECISION_REPORT = DATA / "postcode_coordinate_build_report.json"


def clean(value: object) -> str:
    if pd.isna(value):
        return ""
    return " ".join(str(value).split()).strip()


def first_nonblank(values: pd.Series) -> str:
    for value in values:
        text = clean(value)
        if text:
            return text
    return ""


def join_unique(values: pd.Series) -> str:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = clean(value)
        if not text or text.lower() == "nan" or text in seen:
            continue
        seen.add(text)
        output.append(text)
    return "|".join(output)


def price_num(value: object) -> float | None:
    try:
        if pd.isna(value):
            return None
        return round(float(str(value).replace("£", "").strip()), 2)
    except Exception:  # noqa: BLE001 - source data can contain messy text.
        return None


def pub_url_from_fields(address: str, pub_name: str) -> str:
    if not address or not pub_name:
        return ""
    return f"https://www.pint-prices.com/pub/{quote(address, safe='')}/{quote(pub_name, safe='')}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def apply_postcode_coordinate_decisions(
    app: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, object]]:
    latitudes = pd.to_numeric(app["latitude"], errors="coerce")
    longitudes = pd.to_numeric(app["longitude"], errors="coerce")
    product_candidates = app[
        latitudes.between(LONDON_LAT_MIN, LONDON_LAT_MAX)
        & longitudes.between(LONDON_LON_MIN, LONDON_LON_MAX)
    ]
    result = subprocess.run(
        ["node", str(DECISION_SCRIPT)],
        input=product_candidates.to_json(orient="records"),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr.rstrip(), file=sys.stderr)
        raise SystemExit(result.returncode)

    decisions = json.loads(result.stdout)
    for correction in decisions["appliedCorrections"]:
        matches = app.index[app["app_price_id"].eq(correction["appPriceId"])]
        if len(matches) != 1:
            raise RuntimeError(
                f"validated correction {correction['appPriceId']} no longer matches one row"
            )
        row_index = matches[0]
        for field, value in correction["changes"].items():
            if field in {"latitude", "longitude"}:
                value = str(value)
            app.at[row_index, field] = value
        notes = [
            note
            for note in clean(app.at[row_index, "data_quality_notes"]).split("|")
            if note
        ]
        if correction["dataQualityNote"] not in notes:
            notes.append(correction["dataQualityNote"])
        app.at[row_index, "data_quality_notes"] = "|".join(notes)

    quarantined_ids: set[str] = set()
    for quarantine in decisions["appliedQuarantines"]:
        app_price_id = quarantine["appPriceId"]
        quarantined_ids.add(app_price_id)
        print(
            "[postcode-coordinate quarantine] "
            f"{app_price_id} {quarantine['pubName']} {quarantine['postcode']} "
            f"@ {quarantine['latitude']},{quarantine['longitude']}: "
            f"{quarantine['reason']}"
        )

    report = {
        "inputs": {
            str(path): {"sha256": sha256_file(path)} for path in DECISION_INPUT_FILES
        },
        "checkedRows": decisions["checkedRows"],
        "outwardCodeReferences": decisions["referenceCount"],
        "corrections": decisions["appliedCorrections"],
        "quarantines": decisions["appliedQuarantines"],
    }
    app = app[~app["app_price_id"].isin(quarantined_ids)].copy()
    return app, report


def prep(df: pd.DataFrame, source: str) -> pd.DataFrame:
    df = df.copy()
    expected_columns = [
        "borough",
        "rank",
        "pub_key",
        "pub_name",
        "name",
        "address",
        "pint_name",
        "price_text",
        "price_gbp",
        "pint_position_for_pub",
        "pub_url",
        "constructed_pub_url",
        "borough_url",
        "estimated_average_price_text",
        "latitude",
        "longitude",
        "distance",
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
        "locality",
        "scraped_at",
    ]
    for column in expected_columns:
        if column not in df.columns:
            df[column] = ""

    df["source_dataset"] = source
    df["price_gbp_num"] = df["price_gbp"].map(price_num)
    df["pub_name_clean"] = df.apply(
        lambda row: clean(row["pub_name"]) or clean(row["name"]), axis=1
    )
    df["address_clean"] = df["address"].map(clean)
    df["pint_name_clean"] = df["pint_name"].map(clean)
    df["latitude_clean"] = df["latitude"].map(clean)
    df["longitude_clean"] = df["longitude"].map(clean)
    df["dedupe_key"] = df.apply(
        lambda row: (
            row["pub_name_clean"].lower(),
            row["address_clean"].lower(),
            row["latitude_clean"],
            row["longitude_clean"],
            row["pint_name_clean"].lower(),
            row["price_gbp_num"],
        ),
        axis=1,
    )
    return df


def main() -> None:
    canonical = pd.read_csv(DATA / "pint_prices_canonical_enriched.csv", low_memory=False)
    embedded = pd.read_csv(DATA / "borough_embedded_pint_prices.csv", low_memory=False)
    pub_pages = pd.read_csv(DATA / "pub_page_pint_prices.csv", low_memory=False)

    all_rows = pd.concat(
        [
            prep(canonical, "canonical_borough_leaderboard_enriched"),
            prep(embedded, "borough_embedded_map_data_raw"),
            prep(pub_pages, "individual_pub_page"),
        ],
        ignore_index=True,
    )

    records: list[dict[str, object]] = []
    for _, group in all_rows.groupby("dedupe_key", dropna=False, sort=False):
        visible = group[group["source_dataset"].eq("canonical_borough_leaderboard_enriched")]
        raw = group[group["source_dataset"].eq("borough_embedded_map_data_raw")]
        pub = group[group["source_dataset"].eq("individual_pub_page")]
        preferred = pd.concat([visible, raw, pub], ignore_index=False)

        boroughs_visible = join_unique(visible["borough"])
        raw_boroughs = {clean(value) for value in raw["borough"] if clean(value)}
        anomaly_hits = sorted(raw_boroughs & ANOMALY_BOROUGHS)
        non_anomaly_raw = raw[~raw["borough"].isin(list(ANOMALY_BOROUGHS))]
        quality_notes: list[str] = []
        if anomaly_hits:
            quality_notes.append("raw_embedded_includes_site_anomaly_borough")
        if visible.empty:
            quality_notes.append("not_visible_in_borough_leaderboard")
        if pub.empty:
            quality_notes.append("not_found_on_individual_pub_page_extract")
        if not first_nonblank(preferred["latitude_clean"]) or not first_nonblank(
            preferred["longitude_clean"]
        ):
            quality_notes.append("missing_coordinates")

        pub_name = first_nonblank(preferred["pub_name_clean"])
        address = first_nonblank(preferred["address_clean"])
        constructed_pub_url = first_nonblank(preferred["constructed_pub_url"]) or pub_url_from_fields(
            address, pub_name
        )

        records.append(
            {
                "app_price_id": f"app_price_{len(records) + 1:06d}",
                "pub_name": pub_name,
                "pint_name": first_nonblank(preferred["pint_name_clean"]),
                "price_gbp": first_nonblank(preferred["price_gbp_num"]),
                "price_text": first_nonblank(preferred["price_text"]),
                "address": address,
                "latitude": first_nonblank(preferred["latitude_clean"]),
                "longitude": first_nonblank(preferred["longitude_clean"]),
                "boroughs_visible": boroughs_visible,
                "boroughs_raw_embedded": join_unique(raw["borough"]),
                "boroughs_raw_embedded_non_anomaly": join_unique(non_anomaly_raw["borough"]),
                "boroughs_raw_embedded_site_anomaly": "|".join(anomaly_hits),
                "boroughs_all_sources": join_unique(group["borough"]),
                # NEVER let an ANOMALY_BOROUGHS value become primary: the site
                # glitch tagged hundreds of pubs under Havering/Hillingdon/
                # Redbridge, and the old last-resort `group["borough"]` fallback
                # resurrected exactly those values (593 rows all labelled
                # "Havering" — the F7 borough-join bug). Rows with no trusted
                # source stay blank here; export_app_dataset_json.py assigns
                # the true borough geometrically from lat/lng.
                "primary_borough": first_nonblank(visible["borough"])
                or first_nonblank(non_anomaly_raw["borough"])
                or first_nonblank(
                    group.loc[~group["borough"].isin(list(ANOMALY_BOROUGHS)), "borough"]
                ),
                "rank_visible_borough": first_nonblank(visible["rank"]),
                "estimated_average_price_text": first_nonblank(
                    visible["estimated_average_price_text"]
                ),
                "pub_url": first_nonblank(preferred["pub_url"]) or constructed_pub_url,
                "constructed_pub_url": constructed_pub_url,
                "borough_urls": join_unique(preferred["borough_url"]),
                "pub_key": first_nonblank(preferred["pub_key"]),
                "pint_position_for_pub": first_nonblank(preferred["pint_position_for_pub"]),
                "phone_number": first_nonblank(preferred["phone_number"]),
                "email": first_nonblank(preferred["email"]),
                "website": first_nonblank(preferred["website"]),
                "booking_link": first_nonblank(preferred["booking_link"]),
                "image_url": first_nonblank(preferred["image_url"]),
                "description": first_nonblank(preferred["description"]),
                "comment": first_nonblank(preferred["comment"]),
                "food": first_nonblank(preferred["food"]),
                "cocktails": first_nonblank(preferred["cocktails"]),
                "beer_garden": first_nonblank(preferred["beer_garden"]),
                "live_sports": first_nonblank(preferred["live_sports"]),
                "live_music": first_nonblank(preferred["live_music"]),
                "pub_quiz": first_nonblank(preferred["pub_quiz"]),
                "darts": first_nonblank(preferred["darts"]),
                "pool": first_nonblank(preferred["pool"]),
                "happy_hour": first_nonblank(preferred["happy_hour"]),
                "karaoke": first_nonblank(preferred["karaoke"]),
                "cool": first_nonblank(preferred["cool"]),
                "locality": first_nonblank(preferred["locality"]),
                "source_datasets": join_unique(group["source_dataset"]),
                "source_row_count": len(group),
                "visible_borough_source_row_count": len(visible),
                "raw_embedded_source_row_count": len(raw),
                "individual_pub_page_source_row_count": len(pub),
                "has_visible_borough_row": not visible.empty,
                "has_raw_embedded_map_row": not raw.empty,
                "has_individual_pub_page_row": not pub.empty,
                "is_clean_canonical_app_row": (not visible.empty)
                and bool(first_nonblank(preferred["latitude_clean"]))
                and bool(first_nonblank(preferred["longitude_clean"])),
                "data_quality_notes": "|".join(quality_notes),
                "scraped_at_values": join_unique(preferred["scraped_at"]),
            }
        )

    app = pd.DataFrame(records)
    app = app.sort_values(
        ["is_clean_canonical_app_row", "primary_borough", "pub_name", "pint_name", "price_gbp"],
        ascending=[False, True, True, True, True],
    ).reset_index(drop=True)
    app["app_price_id"] = [f"app_price_{index + 1:06d}" for index in range(len(app))]
    app, decision_report = apply_postcode_coordinate_decisions(app)
    output_path = DATA / "pint_prices_app_dataset.csv"
    app.to_csv(output_path, index=False)
    decision_report["output"] = {
        "path": str(output_path),
        "sha256": sha256_file(output_path),
        "rows": len(app),
    }
    DECISION_REPORT.write_text(
        json.dumps(decision_report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    summary_path = DATA / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary.update(
        {
            "pint_prices_app_dataset_rows": len(app),
            "pint_prices_app_dataset_columns": len(app.columns),
            "app_dataset_rows_with_coordinates": int(
                app[["latitude", "longitude"]].replace("", pd.NA).notna().all(axis=1).sum()
            ),
            "app_dataset_clean_canonical_rows": int(app["is_clean_canonical_app_row"].sum()),
            "app_dataset_rows_with_visible_borough": int(app["has_visible_borough_row"].sum()),
            "app_dataset_rows_with_pub_page": int(app["has_individual_pub_page_row"].sum()),
            "app_dataset_visible_borough_source_rows_represented": int(
                app["visible_borough_source_row_count"].sum()
            ),
            "app_dataset_raw_embedded_source_rows_represented": int(
                app["raw_embedded_source_row_count"].sum()
            ),
            "app_dataset_individual_pub_page_source_rows_represented": int(
                app["individual_pub_page_source_row_count"].sum()
            ),
            "app_dataset_rows_raw_only": int(
                (
                    ~app["has_visible_borough_row"]
                    & app["has_raw_embedded_map_row"]
                    & ~app["has_individual_pub_page_row"]
                ).sum()
            ),
        }
    )
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"wrote {output_path}")
    print(f"rows={len(app)} columns={len(app.columns)}")


if __name__ == "__main__":
    main()
