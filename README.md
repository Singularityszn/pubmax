# PUBMAXXING

**Every pint has a story.** A **price-aware, story-led London night-out map and pub-crawl planner**. Pubs keep observed pint prices; hand-curated bars, late-food institutions, and iconic restaurants use labelled, dated anchors for the item actually priced. Three layers share one living 3-D map: **price**, **setting**, and **story**, with visible provenance so history and legend never blur.

Pick a crawl style, filter, and either accept a **Suggested Crawl** or **Build your own** by tapping pubs — or load a curated **Featured route** or **Pubs near me**. Any crawl is captured in the URL and shareable. Tap a pub to open **The Landlord**, a retrieval-grounded AI that tells the pub's real history and honestly says when it doesn't know.

## Features

- **Landing** — themed intro that links straight into the planner (`/map?style=heritage`).
- **3-D map** - pitched, slowly-orbiting MapLibre view of London and supported UK cities. Curated London venues use distinct pub, bar, late-food, and restaurant glyphs. A keyboard and screen-reader [List view](docs/A11Y_MATRIX_2026-07-18.md#follow-up-status) follows the venues currently visible through the map's filters and opens the same venue sheet as a pin. By default the map is priced by the pint: pub colours use pint-price thresholds; bar, food, and restaurant colours use relative bands within their own type; at street zoom, pub pins with a sourced pint price also print the figure itself ("£5.40") beneath the glyph - bar, food, and restaurant anchor prices stay on the venue sheet, labelled, never printed as a bare figure. Choose another drink and both the colour and the printed figure follow that drink instead (see "Priced by your drink"). Kind filters can hide ordinary pins, while selected and deep-linked venues remain visible. Unverified UK pubs appear only after street-level zoom as quieter, unpriced rings.
- **Find your town** - the city chooser searches the nine curated city guides and any other UK place with a mapped pub, without changing the nine city links or the geolocation path. A curated match keeps its full guide, prices and crawls; anywhere else opens the pub map at that place with the unverified UK pub layer streaming, and says plainly that no prices are logged there yet rather than implying the town was checked. Place names are OpenStreetMap locality tags already carried by the committed UK pub data (ODbL 1.0); see [`public/data/uk_base/README.md`](public/data/uk_base/README.md).
- **Typed venue anchors** - bars, late food, and restaurants show labelled, dated, sourced cocktail, food, or signature-dish anchors, never disguised as pint prices. A restaurant's signature dish also seeds its Menu tab as a sourced, dated item. Pint Drops and community price logging remain pub-only.
- **Priced by your drink** - the map answers cheapest pint by default. Pick another drink and pin colour, the printed pin figure and the cheapest-in-this-area list all follow that drink's trusted community prices, with every non-pint figure naming its drink ("£6 Whisky"). A pub with no trusted price for the chosen drink stays neutral and says so, never borrowing its pint or anchor price, and the price key reports whether the map-wide read finished, covered only part of the list, or failed, so an empty map is never passed off as a city with nothing logged. The max-pint-price filter and the pint refinements step aside while another drink owns the map, because a category price proves nothing about a brand, a subtype or a pint band. Only drinks the map can show and clear are offered as a view, so a category you can log but never see selected cannot narrow the map in silence. Cheapest-pint buckets and the Pint Index stay pint-only.
- **No alcohol and food views** - a "Show me" switch under the map search narrows the map to the night you are actually planning. The no-alcohol view keeps venues known to serve without alcohol, any pub with a corroborated soft-drink or alcohol-free price, and sourced food venues; the food view keeps late-food and restaurant venues. Soft drinks and alcohol-free drinks are their own logged categories, held to the same corroboration and freshness rules as a pint, and they colour and label pins like any other chosen drink. A food or dish anchor never prints on a pin: it stays on the venue sheet, labelled and sourced. A view's figure always names its drink or dish, and never reaches cheapest-pint buckets or the Pint Index. A pub with nothing logged says so plainly rather than implying it was checked.
- **Crawl planner** — Suggest mode (greedy nearest-good-neighbour route) or Build mode (tap to add stops); story filters by price, amenities, water, heritage.
- **Curated routes** — named "generational" Featured crawls loaded as ordered stops.
- **Pubs near me** — a crawl built from your geolocation (degrades gracefully if denied).
- **Shareable URLs** — the whole crawl state round-trips through the URL; "Copy link" shares it.
- **Rounds** - a shared beer mat for the buying rotation: whose turn is up, who bought last, what each round cost, and an immutable night diary. Itemised drink prices use the same community corroboration gate as every other submission. No balances, IOUs, or settling up.
- **Pint Drops** — community photos + the price you paid + a passed-down note, moderated.
- **Log tonight's price** - tap a pub, pick a drink category, enter the price; it shows on the pub's own page instantly, on its own dated row, never overwriting the price on record. A first pint report also marks the pub's pin at once with a small unconfirmed dot, but the pin's colour and card restamp with a dated community badge only once a second independent drinker logs the same figure, and a community price over 30 days old hands the map back to the price on record. No sign-up required; a signed-in public profile can take attribution.
- **Contributor record** - `/contributors` ranks public profiles by visible price logs, Visit Reports and weather Recommendations added together across all time. Equal totals share a place. Anonymous prices and hidden contributions stay off the record; detailed attribution and retention terms live in the [privacy notice](https://pubmaxxing.com/privacy).
- **Invite a mate** - signed-in accounts can share an account invite link. A same-journey new-account signup can record a private referral edge, but no referral reward is active; [`docs/REFERRALS.md`](docs/REFERRALS.md) owns the attribution, qualification, and grant boundary.
- **What drinkers noticed** - a quiet panel on the pub's sheet holds four community observations that decide whether you walk in: rough or posh character, step-free access, door policy, and whether people were eating. They read as drinkers' reports and never as venue facts - character always names whose judgement it is, entrance and toilet access are separate questions because British pub toilets are often reached another way, and an access question stays plainly unknown until a second independent drinker confirms it, however old a lone report gets. Anonymous, no sign-up, and none of it moves pin colour, price bands or the Pint Index.
- **What it used to cost** - where the archives evidence it, a pub's sheet sets one dated historical pint price against the price on record now ("£3.60 in April 2014. £5.80 now."), with the source named, dated and linked. A pub with history but no current price still shows the old figure alone, and a bar or food venue never gets the comparison because its anchor price is not a pint. Historical prices are strictly second class: they never move pin colour, price bands, cheapest-pint buckets or the Pint Index.
- **Pint Index** - `/pint-index` ranks London boroughs by observed pint price, with a TfL fare-zone median strip beside it and a dearest-end view of the same league. Only prices carrying a public source and the day they were seen are eligible, which is stricter than the map: an area can post a zone median and still sit empty in the league. Every closed month freezes into its own dated page so a quoted figure stays quotable, and the live page and each dated edition publish a CSV and `Dataset` structured data. Cited national benchmarks sit above the league as somebody else's figures, each naming who counted it and when, never merged into ours.
- **The Landlord** — grounded pub-heritage Q&A that reads back only server-known facts and refuses to invent.
- **Moderation** — reports hide a Pint Drop at a threshold; a token-gated `/admin` console reviews hidden drops. A community price or a drinker's pub observation can also be reported by anyone, but never auto-hides: only a moderator hides it (hide, never delete) through the moderator-gated admin API, one queue for both shapes.

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

Those generated detail files are gitignored (large). Local/dev falls back to the raw pint dataset and curated venue packs when they are missing; production should run `prebuild` / `build:slim` so the index exists. See `docs/DEPLOYMENT.md`.

### Map data attribution

`public/data/london_localities.json` is the Greater London locality gazetteer that powers map search (Willesden, Cricklewood, Gospel Oak…). It is built once from OpenStreetMap place nodes by `scripts/gen_london_localities.mjs`. **OpenStreetMap data is © OpenStreetMap contributors, licensed under the Open Database Licence (ODbL) 1.0** (<https://www.openstreetmap.org/copyright>); the attribution and licence travel in the file's header fields. Regenerate with `node scripts/gen_london_localities.mjs`.

The UK-wide unverified pub layer also comes from OpenStreetMap. Its pins remain
outside the curated venue index, and its sheet displays source attribution while
accepting community price submissions. Because OSM-derived venues ship in both
pub layers, the map corner itself credits OpenStreetMap contributors (ODbL) via
`OSM_ATTRIBUTION` in `components/map/canvas/tokens.ts`. See
[`public/data/uk_base/README.md`](public/data/uk_base/README.md) for the runtime
data contract.

## Demo data

The community layer ships alive: hand-written Pint Drops and Featured crawls are seeded so the map has content on day one. Seeded content is tagged `demo` and stays **visibly distinct** — it never masquerades as organic contributor signal and is filtered out before it can move any price or story metric. Provenance chips (`Sourced` / `Contributor` / `Anecdote` / `Demo`) are the product's trust signal.

## Deeper docs

- **`teach.md`** — full repo tour: architecture, data model, map lifecycle, backend, trust boundaries, with `file:line` anchors.
- **`docs/DEPLOYMENT.md`** — reproducible Vercel + Supabase + OpenRouter runbook.
- **[`docs/CRON_PLANE_RUNBOOK.md`](docs/CRON_PLANE_RUNBOOK.md)** - scheduler, auth, failure posture, and honest freshness boundaries.
- **[`docs/WAYFINDER_LIVE_DATA.md`](docs/WAYFINDER_LIVE_DATA.md)** - source, cadence, gate, and staleness policy for every data class.
- **[`docs/NIGHT_OUT_PLACE_INGEST.md`](docs/NIGHT_OUT_PLACE_INGEST.md)** - provenance and freshness contract for automated place discovery and hand-curated venue packs.
- **[`docs/REFERRALS.md`](docs/REFERRALS.md)** - private attribution, qualification, and permanent-grant integrity boundary.
- **`docs/DEMO_DECK.md`** — demo script.
- **[`data/osm/uk/README.md`](data/osm/uk/README.md)** - UK-wide OSM seed-pack refresh, provenance, dedupe, and runtime shard generation.
- **[`public/data/price_history/README.md`](public/data/price_history/README.md)** - what earns a row in the hand-curated historical price file, where wave one came from, and what it yielded.
