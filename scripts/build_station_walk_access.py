# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "city2graph==1.0.0",
#   "overturemaps==1.0.2",
#   "pyproj>=3.6",
# ]
# ///
"""Build data/station_walk_access.json: street-network walks to the nearest stations.

WHY. The Last Pint leave-by clock walks a drinker to the station at the
straight-line distance. Central London streets do not run straight: the
2026-10-16 West End pilot measured the street walk at a median 1.54 times the
straight line, and 2 times at the 90th percentile, so the card told people they
had a third more time than they did.

WHAT. For every point of the 0.001-degree grid inside the pilot box, the street
walking distance to up to three of the nearest stations, by street walk. The
grid is the SAME rounding `coarsenViewerPoint` applies before a point leaves
the browser (lib/geo.ts), so the server can look a request up without ever
being sent a finer point. A walk is the street path between the nodes the
grid point and the station snap to, plus both straight snap legs, so it can
never be shorter than the straight line to where it ends.

HOW. city2graph turns Overture Maps transportation segments (OpenStreetMap
under ODbL) into a street graph, split at Overture's own connectors. Rail,
water and motorways are not walkable and are dropped. Stations come from
data/tfl_station_zones.json, which records one point per station.

ENTRANCES. A station point can sit in the middle of a block, a long way round
from the door. Given the DfT's NaPTAN stops CSV (Open Government Licence), the
builder routes each station from all of its entrances at once (StopType TMU
for the Underground, RSE for rail), so a walk ends at whichever door is the
shortest walk. An entrance joins a station only when its name carries the
station's name and it sits within ENTRANCE_MATCH_M of the station point; every
entrance that cannot be joined is counted and printed, never guessed. A
station with no joined entrance keeps its mapped point, and the output says
which is which.

RUN. A pinned Python tool under uv and NEVER a repo dependency:

    uv run scripts/build_station_walk_access.py --entrances path/to/Stops.csv

The NaPTAN download is https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv
(all of Great Britain, about 100 MB). Without --entrances the build routes to
station points, as the first pilot did.

It reads Overture's public S3 bucket directly (no STAC catalog), pinned to
OVERTURE_RELEASE, and writes only data/station_walk_access.json. Widening the
pilot is a change to PILOT and a re-run; the reader in
lib/stationWalkAccess.ts falls back to the straight line outside it.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import city2graph
import networkx as nx
import numpy as np
import overturemaps.core as overture
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
STATIONS_PATH = ROOT / "data" / "tfl_station_zones.json"
OUT_PATH = ROOT / "data" / "station_walk_access.json"

OVERTURE_RELEASE = "2026-09-23.1"

# The pilot. `grid` is the area a request may be answered for; `network` is
# the street graph, wider on every side so a walk near the grid's edge can
# still leave it and come back.
PILOT = {
    "id": "west-end",
    "label": "Soho, Covent Garden, Fitzrovia and the Strand",
    "grid": (-0.141, 51.508, -0.119, 51.519),
    "network": (-0.150, 51.502, -0.110, 51.525),
}

GRID_STEP = 0.001
STATIONS_PER_CELL = 3
MAX_WALK_M = 2_000
# A grid point further than this from any walkable street is inside a block or
# a park, and the snap leg would be a guess, so that cell is left out.
MAX_SNAP_M = 60.0
# NaPTAN StopTypes for a door into a station: TMU is a tram, metro or
# Underground entrance and RSE a rail station entrance.
ENTRANCE_STOP_TYPES = {"TMU", "RSE"}
ENTRANCE_MATCH_M = 400.0
NAPTAN_COLUMNS = {"ATCOCode", "CommonName", "Latitude", "Longitude", "StopType"}
NOT_WALKABLE_SUBTYPES = {"rail", "water"}
NOT_WALKABLE_CLASSES = {"motorway"}

to_bng = Transformer.from_crs(4326, 27700, always_xy=True)


def load_segments(bbox: tuple[float, float, float, float]):
    segments = overture.geodataframe("segment", bbox=bbox, release=OVERTURE_RELEASE, stac=False)
    connectors = overture.geodataframe("connector", bbox=bbox, release=OVERTURE_RELEASE, stac=False)
    segments = segments.set_crs(4326, allow_override=True)
    connectors = connectors.set_crs(4326, allow_override=True)
    segments = segments[
        ~segments["subtype"].isin(NOT_WALKABLE_SUBTYPES)
        & ~segments["class"].isin(NOT_WALKABLE_CLASSES)
    ].copy()
    # city2graph parses `connectors` from the JSON text its own GeoJSON loader
    # produces; the S3 reader hands back arrays, so serialise them the same way.
    segments["connectors"] = segments["connectors"].map(
        lambda value: None
        if value is None
        else json.dumps([{"connector_id": c["connector_id"], "at": float(c["at"])} for c in value])
    )
    # Barriers from level rules are not used for walking, and the raw arrays
    # trip the same parser.
    segments["level_rules"] = None
    return segments.to_crs(27700), connectors.to_crs(27700)


def walk_graph(segments, connectors) -> nx.Graph:
    split = city2graph.process_overture_segments(
        segments, get_barriers=False, connectors_gdf=connectors, threshold=1.0
    )
    multigraph = city2graph.segments_to_graph(split, multigraph=True, directed=False, as_nx=True)
    giant = max(nx.connected_components(multigraph), key=len)
    graph = nx.Graph()
    for u, v, data in multigraph.subgraph(giant).edges(data=True):
        metres = float(data["geometry"].length)
        if not graph.has_edge(u, v) or graph[u][v]["m"] > metres:
            graph.add_edge(u, v, m=metres)
    for node in graph.nodes:
        graph.nodes[node]["pos"] = multigraph.nodes[node]["pos"]
    return graph


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def grid_keys(bbox: tuple[float, float, float, float]) -> list[tuple[str, float, float]]:
    min_lng, min_lat, max_lng, max_lat = bbox
    lats = np.arange(round(min_lat / GRID_STEP), round(max_lat / GRID_STEP) + 1) * GRID_STEP
    lngs = np.arange(round(min_lng / GRID_STEP), round(max_lng / GRID_STEP) + 1) * GRID_STEP
    out = []
    for lat in lats:
        for lng in lngs:
            lat_r, lng_r = round(float(lat), 3), round(float(lng), 3)
            out.append((f"{lat_r:.3f},{lng_r:.3f}", lat_r, lng_r))
    return out


def name_tokens(name: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", name.lower().replace("'", "").replace("\u2019", ""))


def load_entrances(path: Path, stations: list[dict]) -> tuple[list[list[tuple[float, float]]], dict]:
    """Join NaPTAN entrances to stations; return per-station [(lat, lng)] and a tally."""
    joined: list[list[tuple[float, float]]] = [[] for _ in stations]
    tally = {"read": 0, "joined": 0, "unjoined": 0, "inactive": 0}
    min_lng, min_lat, max_lng, max_lat = PILOT["network"]
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        missing = NAPTAN_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"{path} is not a NaPTAN stops CSV: missing {sorted(missing)}")
        for row in reader:
            if row["StopType"] not in ENTRANCE_STOP_TYPES:
                continue
            try:
                lat, lng = float(row["Latitude"]), float(row["Longitude"])
            except ValueError:
                continue
            if not (min_lng < lng < max_lng and min_lat < lat < max_lat):
                continue
            tally["read"] += 1
            if row.get("Status", "active").strip().lower() not in ("active", "act", ""):
                tally["inactive"] += 1
                continue
            entrance_name = " ".join(name_tokens(row["CommonName"]))
            best: tuple[float, int] | None = None
            for index, station in enumerate(stations):
                station_name = " ".join(name_tokens(station["name"]))
                if f" {station_name} " not in f" {entrance_name} ":
                    continue
                metres = haversine_m(lat, lng, station["lat"], station["lng"])
                if metres <= ENTRANCE_MATCH_M and (best is None or metres < best[0]):
                    best = (metres, index)
            if best is None:
                tally["unjoined"] += 1
                print(f"entrance not joined to a station: {row['ATCOCode']} {row['CommonName']}", file=sys.stderr)
                continue
            joined[best[1]].append((lat, lng))
            tally["joined"] += 1
    return joined, tally


def to_json(payload: dict) -> str:
    """One station and one cell per line, so a rebuild diffs by the cell."""
    head = {k: v for k, v in payload.items() if k not in ("stations", "cells")}
    lines = json.dumps(head, indent=1, ensure_ascii=False)[:-2].splitlines()
    stations = [json.dumps(s, ensure_ascii=False) for s in payload["stations"]]
    cells = [f"  {json.dumps(k)}: {json.dumps(v)}" for k, v in sorted(payload["cells"].items())]
    return (
        "\n".join(lines)
        + ',\n "stations": [\n  '
        + ",\n  ".join(stations)
        + '\n ],\n "cells": {\n'
        + ",\n".join(cells)
        + "\n }\n}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--entrances", type=Path, help="NaPTAN stops CSV; route to station entrances")
    args = parser.parse_args()

    stations_all = json.loads(STATIONS_PATH.read_text())["stations"]
    min_lng, min_lat, max_lng, max_lat = PILOT["network"]
    stations = sorted(
        (s for s in stations_all if min_lng < s["lng"] < max_lng and min_lat < s["lat"] < max_lat),
        key=lambda s: s["name"],
    )
    if not stations:
        print("no stations inside the pilot network box", file=sys.stderr)
        return 1

    entrances: list[list[tuple[float, float]]] = [[] for _ in stations]
    entrance_tally: dict | None = None
    if args.entrances:
        entrances, entrance_tally = load_entrances(args.entrances, stations)
    # Where a walk to each station may end: its entrances, else its mapped point.
    endpoints = [e or [(s["lat"], s["lng"])] for s, e in zip(stations, entrances)]

    graph = walk_graph(*load_segments(PILOT["network"]))
    node_ids = list(graph.nodes)
    node_xy = np.array([graph.nodes[n]["pos"] for n in node_ids])

    def snap(lat: float, lng: float) -> tuple[object, float]:
        x, y = to_bng.transform(lng, lat)
        d = np.hypot(node_xy[:, 0] - x, node_xy[:, 1] - y)
        i = int(d.argmin())
        return node_ids[i], float(d[i])

    # One search per station from all of its endpoints at once: a virtual
    # source joined to each endpoint's street node by that endpoint's snap leg,
    # so a path length already includes the leg to whichever door it ends at.
    reach: list[dict] = []
    for index, points in enumerate(endpoints):
        source = ("station", index)
        graph.add_node(source)
        for lat, lng in points:
            node, snap_m = snap(lat, lng)
            if not graph.has_edge(source, node) or graph[source][node]["m"] > snap_m:
                graph.add_edge(source, node, m=snap_m)
        lengths = nx.single_source_dijkstra_path_length(graph, source, cutoff=MAX_WALK_M, weight="m")
        graph.remove_node(source)
        reach.append({"lengths": lengths})

    cells: dict[str, list[list[int]]] = {}
    skipped_snap = 0
    ratios: list[float] = []
    for key, lat, lng in grid_keys(PILOT["grid"]):
        node, snap_m = snap(lat, lng)
        if snap_m > MAX_SNAP_M:
            skipped_snap += 1
            continue
        walks = []
        for index, (station, r) in enumerate(zip(stations, reach)):
            path_m = r["lengths"].get(node)
            if path_m is None:
                continue
            walk_m = snap_m + path_m
            straight_m = min(haversine_m(lat, lng, elat, elng) for elat, elng in endpoints[index])
            # Triangle inequality: snap + path + snap is never shorter than the
            # straight line to the nearest place the walk may end. Rounding
            # aside, a shorter one is a broken graph.
            if walk_m + 1 < straight_m:
                print(f"walk shorter than straight line at {key} -> {station['name']}", file=sys.stderr)
                return 1
            walk_m = max(walk_m, straight_m)
            if walk_m <= MAX_WALK_M:
                walks.append((walk_m, index, straight_m))
        walks.sort()
        if walks:
            cells[key] = [[index, round(walk_m)] for walk_m, index, _ in walks[:STATIONS_PER_CELL]]
            ratios.extend(w / s for w, _, s in walks[:STATIONS_PER_CELL] if s > 50)

    payload = {
        "_provenance": {
            "source": "Overture Maps Foundation transportation segments",
            "release": OVERTURE_RELEASE,
            "licence": "ODbL-1.0. Contains OpenStreetMap data, © OpenStreetMap contributors, via Overture Maps.",
            "stations": "data/tfl_station_zones.json (one point per station)",
            "entrances": (
                f"NaPTAN stops CSV, StopType {sorted(ENTRANCE_STOP_TYPES)}, Open Government Licence v3.0; "
                f"{entrance_tally['joined']} joined, {entrance_tally['unjoined']} not joined"
                if entrance_tally
                else "none: every walk ends at the station point"
            ),
            "method": (
                "city2graph street graph split at Overture connectors; rail, water and motorways "
                "dropped. Walk = snap leg + shortest street path + snap leg to the nearest "
                "entrance on foot (the station point where none is joined), never below the "
                "straight line to where it ends."
            ),
            "builder": "scripts/build_station_walk_access.py",
            "city2graph": version("city2graph"),
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "pilot": {"id": PILOT["id"], "label": PILOT["label"], "grid": list(PILOT["grid"])},
        "gridStepDegrees": GRID_STEP,
        "maxWalkMetres": MAX_WALK_M,
        "stations": [
            {"name": s["name"], "lat": s["lat"], "lng": s["lng"]}
            | ({"entrances": [[round(a, 6), round(b, 6)] for a, b in e]} if e else {})
            for s, e in zip(stations, entrances)
        ],
        "cells": cells,
    }
    OUT_PATH.write_text(to_json(payload))
    median = float(np.median(ratios)) if ratios else float("nan")
    p90 = float(np.percentile(ratios, 90)) if ratios else float("nan")
    print(
        f"wrote {OUT_PATH.relative_to(ROOT)}: {len(cells)} cells, {len(stations)} stations, "
        f"{skipped_snap} cells off-street; street/straight median {median:.2f}, p90 {p90:.2f}"
    )
    if entrance_tally:
        with_doors = sum(1 for e in entrances if e)
        print(
            f"entrances: {entrance_tally['joined']} joined to {with_doors}/{len(stations)} stations, "
            f"{entrance_tally['unjoined']} not joined, {entrance_tally['inactive']} inactive"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
