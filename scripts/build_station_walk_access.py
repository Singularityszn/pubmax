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
never be shorter than the straight line.

HOW. city2graph turns Overture Maps transportation segments (OpenStreetMap
under ODbL) into a street graph, split at Overture's own connectors. Rail,
water and motorways are not walkable and are dropped. Stations come from
data/tfl_station_zones.json, which records station points rather than
entrances, so a walk ends at the station's mapped point.

RUN. A pinned Python tool under uv and NEVER a repo dependency:

    uv run scripts/build_station_walk_access.py

It reads Overture's public S3 bucket directly (no STAC catalog), pinned to
OVERTURE_RELEASE, and writes only data/station_walk_access.json. Widening the
pilot is a change to PILOT and a re-run; the reader in
lib/stationWalkAccess.ts falls back to the straight line outside it.
"""

from __future__ import annotations

import json
import math
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
    stations_all = json.loads(STATIONS_PATH.read_text())["stations"]
    min_lng, min_lat, max_lng, max_lat = PILOT["network"]
    stations = sorted(
        (s for s in stations_all if min_lng < s["lng"] < max_lng and min_lat < s["lat"] < max_lat),
        key=lambda s: s["name"],
    )
    if not stations:
        print("no stations inside the pilot network box", file=sys.stderr)
        return 1

    graph = walk_graph(*load_segments(PILOT["network"]))
    node_ids = list(graph.nodes)
    node_xy = np.array([graph.nodes[n]["pos"] for n in node_ids])

    def snap(lat: float, lng: float) -> tuple[object, float]:
        x, y = to_bng.transform(lng, lat)
        d = np.hypot(node_xy[:, 0] - x, node_xy[:, 1] - y)
        i = int(d.argmin())
        return node_ids[i], float(d[i])

    reach: list[dict] = []
    for station in stations:
        node, snap_m = snap(station["lat"], station["lng"])
        lengths = nx.single_source_dijkstra_path_length(graph, node, cutoff=MAX_WALK_M, weight="m")
        reach.append({"snap_m": snap_m, "lengths": lengths})

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
            walk_m = snap_m + path_m + r["snap_m"]
            straight_m = haversine_m(lat, lng, station["lat"], station["lng"])
            # Triangle inequality: snap + path + snap is never shorter than the
            # straight line. Rounding aside, a shorter one is a broken graph.
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
            "stations": "data/tfl_station_zones.json (station points, not entrances)",
            "method": (
                "city2graph street graph split at Overture connectors; rail, water and motorways "
                "dropped. Walk = snap leg + shortest street path + snap leg, never below the "
                "straight line."
            ),
            "builder": "scripts/build_station_walk_access.py",
            "city2graph": version("city2graph"),
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "pilot": {"id": PILOT["id"], "label": PILOT["label"], "grid": list(PILOT["grid"])},
        "gridStepDegrees": GRID_STEP,
        "maxWalkMetres": MAX_WALK_M,
        "stations": [{"name": s["name"], "lat": s["lat"], "lng": s["lng"]} for s in stations],
        "cells": cells,
    }
    OUT_PATH.write_text(to_json(payload))
    median = float(np.median(ratios)) if ratios else float("nan")
    p90 = float(np.percentile(ratios, 90)) if ratios else float("nan")
    print(
        f"wrote {OUT_PATH.relative_to(ROOT)}: {len(cells)} cells, {len(stations)} stations, "
        f"{skipped_snap} cells off-street; street/straight median {median:.2f}, p90 {p90:.2f}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
