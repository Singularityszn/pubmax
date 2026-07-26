# PUBMAXXING

**Every pint has a story.** A **price-aware, story-led London pub-crawl planner**. Three layers on one living 3-D map: the **price** of every observed pint (colour-coded cheap → expensive), the **setting** (by the water, gardens, walkable route shape), and the **story** (pub heritage, sourced editorial picks, and community **Pint Drops** — each carrying visible provenance so history and legend never blur).

Pick a crawl style, filter, and either accept a **Suggested Crawl** or **Build your own** by tapping pubs — or load a curated **Featured route** or **Pubs near me**. Any crawl is captured in the URL and shareable. Tap a pub to open **The Landlord**, a retrieval-grounded AI that tells the pub's real history and honestly says when it doesn't know.

## Features

- **Landing** — themed intro that links straight into the planner (`/map?style=heritage`).
- **3-D map** - pitched, slowly-orbiting MapLibre view of London and supported UK cities. Curated pubs keep their price-coloured markers; unverified UK pubs appear only after street-level zoom as quieter, unpriced rings.
- **Crawl planner** — Suggest mode (greedy nearest-good-neighbour route) or Build mode (tap to add stops); story filters by price, amenities, water, heritage.
- **Curated routes** — named "generational" Featured crawls loaded as ordered stops.
- **Pubs near me** — a crawl built from your geolocation (degrades gracefully if denied).
- **Shareable URLs** — the whole crawl state round-trips through the URL; "Copy link" shares it.
- **Pint Drops** — community photos + the price you paid + a passed-down note, moderated.
- **Log tonight's price** - tap a pub, pick a drink category, enter the price; it shows on the pub's own page instantly, on its own dated row, never overwriting the price on record. The pin and card restamp with a dated community badge only once a second independent drinker logs the same figure, and a community price over 30 days old hands the map back to the price on record. Anonymous, no sign-up.
- **The Landlord** — grounded pub-heritage Q&A that reads back only server-known facts and refuses to invent.
- **Moderation** — reports hide a drop at a threshold; a token-gated `/admin` console reviews hidden drops.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · MapLibre GL + OpenFreeMap
basemaps (CARTO fallback) · Supabase (Postgres + Storage + RLS) · OpenRouter
(Claude) for The Landlord · Vitest + Playwright · deployed on Vercel.

## Quick start

```sh
npm install
npm run dev            # http://localhost:3000 — works with NO secrets
```

The app runs **keyless** for local dev: Pint Drops use an in-memory store and The Landlord answers in grounded/structured mode (reads the facts on record; no narration). To light up the durable seams, copy `.env.example` → `.env.local` and add Supabase + `OPENROUTER_API_KEY`.

Useful scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run verify` | validate-data · lint · typecheck · coverage — the local pre-push gate |
| `npm run ci` | `verify` + build — the full gate (what Vercel runs) |
| `npm run ci:isolated` | Collision-safe keyless `ci` in a unique temporary Next dist directory; restores Next-managed tracked files |
| `npm test` | Vitest unit suite |
| `npm run test:e2e` | Playwright smoke (builds, starts, drives Chromium) |
| `npm run shots` | Required 390/1440 light/dark Gate-Z screenshots |
| `npm run shots:extended` | Adds the 430/1280 breakpoint audit |
| `npm run setup` | Enables the pre-push git hook (`core.hooksPath=.githooks`) — run once |
| `npm run build:slim` | Slim map index + **venue detail artifacts** (`data/generated/`) — also runs on `prebuild` |

### Venue detail index

`npm run build:slim` (`scripts/build_slim_index.mjs`) writes:

- `public/data/venues_slim.json` — map pins (committed / shipped to the browser)
- `data/generated/venue_detail_index.json` + `venue_details.jsonl` — server-side lazy detail for `/api/venue/[id]`

Those generated detail files are gitignored (large). Local/dev falls back to the raw pint dataset when they are missing; production should run `prebuild` / `build:slim` so the index exists. See `docs/DEPLOYMENT.md`.

### Map data attribution

`public/data/london_localities.json` is the Greater London locality gazetteer that powers map search (Willesden, Cricklewood, Gospel Oak…). It is built once from OpenStreetMap place nodes by `scripts/gen_london_localities.mjs`. **OpenStreetMap data is © OpenStreetMap contributors, licensed under the Open Database Licence (ODbL) 1.0** (<https://www.openstreetmap.org/copyright>); the attribution and licence travel in the file's header fields. Regenerate with `node scripts/gen_london_localities.mjs`.

The UK-wide unverified pub layer also comes from OpenStreetMap. Its pins remain
outside the curated venue index, and its sheet displays source attribution while
accepting community price submissions. See
[`public/data/uk_base/README.md`](public/data/uk_base/README.md) for the runtime
data contract.

## Demo data

The community layer ships alive: hand-written Pint Drops and Featured crawls are seeded so the map has content on day one. Seeded content is tagged `demo` and stays **visibly distinct** — it never masquerades as organic contributor signal and is filtered out before it can move any price or story metric. Provenance chips (`Sourced` / `Contributor` / `Anecdote` / `Demo`) are the product's trust signal.

## Deeper docs

- **`teach.md`** — full repo tour: architecture, data model, map lifecycle, backend, trust boundaries, with `file:line` anchors.
- **`docs/DEPLOYMENT.md`** — reproducible Vercel + Supabase + OpenRouter runbook.
- **`docs/DEMO_DECK.md`** — demo script.
- **[`data/osm/uk/README.md`](data/osm/uk/README.md)** - UK-wide OSM seed-pack refresh, provenance, dedupe, and runtime shard generation.
