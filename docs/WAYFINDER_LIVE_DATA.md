# Wayfinder live-data programme

> Owner directive: **"we need to ALWAYS get live data."**

This is the honest map of every data class the app ships: where it comes from,
how it actually refreshes **today**, what gates its freshest cadence, and how
stale it is allowed to get. It is paired with a machine-readable spine so the
answer to "how live is X?" is one lookup, not tribal knowledge:

- **Registry (source of truth):** [`data/freshness_registry.json`](../data/freshness_registry.json)
- **Checker (owner/CI gate):** [`scripts/check_freshness.mjs`](../scripts/check_freshness.mjs) — `node scripts/check_freshness.mjs`
- **Advisory WARN in the data gate:** wired into `npm run validate-data` (never fails the build)
- **Runtime view:** `GET /api/freshness` ([`app/api/freshness/route.ts`](../app/api/freshness/route.ts))
- **Human labels:** [`lib/freshness.ts`](../lib/freshness.ts) statuses feed the existing `lib/dataFreshness.ts` staleness idioms

A first principle runs through every class: **never present stale as live.**
Every fact carries `{source, observedAt}`; scheduled jobs open a review PR and
never push to a protected branch; the freshest possible cadence is bounded by
what the *honest* source (first-party page, official API, open data) supports.

---

## 1. Cadence table

| Data class | Current source | Refresh path (today) | Actual cadence today | Gate | Freshest honest cadence | Staleness budget |
|---|---|---|---|---|---|---|
| **TfL last-train / last-drink** | `api.tfl.gov.uk` (keyless) | `app/api/last-train` fetches **per request**, never disk-cached | Live | none (`TFL_APP_KEY` only raises limits) | Live (real-time arrivals) | live |
| **Weather** | Open-Meteo (keyless) | `Weather cache refresh` workflow → `refresh:weather` → PR → `public/data/weather/latest.json` | **Daily 14:15 UTC** | none | Hourly if desired (Open-Meteo is generous) | 48 h |
| **Night signals** | Staged candidate claims, offline-reviewed | `Night Signal refresh` workflow → `refresh:night-signals` → PR → `night_signals/latest.json` | **Daily 08:15 UTC** | `EXA_API_KEY` arms candidate ingestion; **human review always** | Daily (review-bound) | 48 h |
| **What's-On — baseline** (sport/quiz/deals/music) | Hand-verified first-party rows in `scripts/whatson/*.json` | `refresh:whats-on` (no workflow) + CityMCP blend at request time | Episodic | none | Weekly-ish (hand-curated) | 48 h (envelope) |
| **What's-On — events** (Ticketmaster/Skiddle) | Official discovery APIs | `events-refresh.yml` on `feat/event-sources` — **cron commented out** | **None on main** (branch, keyless-off) | `TICKETMASTER_API_KEY` and/or `SKIDDLE_API_KEY` (Skiddle needs written commercial approval) | Daily 15:45 UTC once keyed | 48 h |
| **Pint prices (core dataset)** | Collected July 2026 snapshot | Manual `export:data → canonicalize:venues → build:slim` | Episodic (bundled static) | none | Re-collection cadence (manual) | 90 d |
| **Price updates (cheapest pint)** | First-party / open sources allowlist | `Price refresh` workflow → `refresh:prices` → PR | **Weekly Mon 07:00 UTC** — but **parser stubbed** (`fetchFromSource → []`), so a run is a safe no-op | none to run; needs a per-source parser | Weekly | 14 d |
| **Drink price updates** | Wetherspoons first-party (allowlist) | `Drink price refresh` workflow → `refresh:drink-prices` → PR | **Weekly Mon 07:30 UTC** — pipeline real but **emits 0 rows** (no per-drink web prices; prices live only in the Order-&-Pay app backend) | none to run; source has no permissible per-drink prices | Weekly | 14 d |
| **Food price updates** | Menu harvest | Manual harvest (no workflow) | Episodic | `FIRECRAWL_API_KEY` for scraping | Episodic | 60 d |
| **Pint Index (borough medians)** | Confirmed Pint Drops + official-publisher / open-data | Recomputed as eligible observations arrive | **Event-sourced** (grows with the product) | none | User-cadence — **the growth loop IS the refresh** | untracked |
| **Late-food evidence** | Hand-evidenced per Night Area | Manual curation | Episodic | none | Episodic | untracked |
| **Venue presence (Wetherspoons/OSM)** | OSM Overpass + directory | `fetch:city-pubs` / `fetch_wetherspoons_pubs.mjs` (manual) | Episodic | `FIRECRAWL_API_KEY` for directory path; OSM keyless | Episodic (OSM changes slowly) | untracked |
| **PUBMAXXING all-drinks / history seed** | Sibling `pubmaxxing` repo | Manual `build:pubmaxxing-seed` import | Episodic | none | Per-import | untracked |
| **CityMCP (buzz/status/journey/places)** | `citymcp.com/london/mcp` (keyless) | Proxied **per request**, short in-process TTLs (3–10 min) | Live | none (buzz quality rides CityMCP's own EXA-backed enrichment) | Live | live |
| **Buzz digest** | CityMCP `get_place` deep synthesis | `app/api/citymcp/buzz` per request | Live but **content is EXA-blocked upstream** — returns `{buzz:null}` when CityMCP has no digest | none locally; upstream EXA-gated | Live | live |
| **TfL line geometry / London POIs** | Curated GeoJSON | Manual | Static | none | Rarely changes | untracked (static) |

---

## 2. Activation matrix — which owner key arms which refresh

The freshest cadence for several classes is **latent**: the pipeline is built
and safe-no-op today, and lights up with **no code change** the moment the owner
sets a secret. Exact env var → mechanism mapping:

| Env var / secret | Where it's set | What it arms | Effect when **absent** (today's reality) |
|---|---|---|---|
| `EXA_API_KEY` | GitHub Actions secret + Vercel env | Night-signal candidate ingestion (scheduled) | Snapshot publishes empty (staged candidates only); nothing in the interactive path breaks |
| `TICKETMASTER_API_KEY` | GH Actions secret (branch `feat/event-sources`) | What's-On **events** vertical (Ticketmaster Discovery) | Provider skipped; contributes 0 rows |
| `SKIDDLE_API_KEY` | GH Actions secret (branch `feat/event-sources`) | What's-On events (Skiddle) — **also needs written commercial approval from dev@skiddle.com** | Provider noop-skipped |
| `FIRECRAWL_API_KEY` | Local `.env` / CI secret | Menu scraping (food prices), Wetherspoons directory refresh, research | Those harvest scripts can't fetch; bundled data unaffected |
| `TFL_APP_KEY` | Vercel env | Higher TfL rate limits | Last-train works fully keyless; only limits are lower |
| `OPENROUTER_API_KEY` | Vercel env | The Landlord heritage narration | `/api/heritage` returns grounded, structured-only answers |
| `POSTHOG_PROJECT_API_KEY` | Vercel env | Server-side analytics forwarding | Events still logged to Vercel structured sink |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_PUB_PAL_AGENT_ID` | Vercel env | Pub Pal conversational voice token | Voice session unavailable |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Vercel env (required in prod) | Pint Drops persistence, moderation, durable rate limiting | Pint Drop writes 503; in-memory demo store locally |

**To activate a scheduled cron:** set the secret above, then (for events)
**uncomment the `schedule:` block** in `.github/workflows/events-refresh.yml`.
The price/drink/night-signal/weather workflows are already scheduled — they just
no-op or publish-empty until their source/key is live.

**Not present on main today** (contrary to a common assumption): there is **no
`RESEND` digest workflow** and **no `APNs` push-sender** wired in this repo.
Analytics is PostHog, not a mail digest. If a digest/push cadence is wanted,
those are net-new build items, not dormant keys.

---

## 3. Gap list — data classes with NO automated refresh path

Honest accounting of what will **not** get fresher on its own:

1. **Pint Index & Pint Drops → user-cadence by design.** There is no cron and
   there shouldn't be: the index only grows from *confirmed* Pint Drops and
   official-publisher/open-data observations. **The growth loop is the refresh
   mechanism.** More users confirming drops = fresher index. Registered as
   `user-cadence`, budget `null`.
2. **Price / drink-price parsers are stubbed or dry.** The weekly workflows run,
   but `refresh_prices.mjs`'s `fetchFromSource` returns `[]` (no parser yet), and
   the drink source (Wetherspoons) exposes **no per-drink web prices** (they live
   only in the native Order-&-Pay backend). So the scheduled cadence exists but
   produces zero rows until a permissible per-source parser lands. **Gap: real
   first-party price parsers.**
3. **What's-On events are branch-only + key-off.** `feat/event-sources` has the
   full Ticketmaster/Skiddle pipeline, but it isn't merged and the cron is
   commented out. **Gap: merge + provider keys (+ Skiddle approval).**
4. **Food prices, late-food evidence, venue presence, all-drinks seed → manual,
   episodic.** No workflow. Refreshed by running the harvest/import script by
   hand. Registered `untracked` (no budget) so they surface honestly without
   nagging the build.
5. **Buzz is upstream-EXA-blocked.** Even live, CityMCP returns no digest for
   many venues; the app renders nothing rather than invent buzz. Nothing to
   automate our side.
6. **No digest / push cadence exists.** See the matrix note above.

---

## 4. Freshness spine (the missing piece this change adds)

The programme's missing spine was a **uniform, machine-readable answer** to "how
live is every class?" Before this, freshness lived in scattered per-feature
constants and prose. Now:

### `data/freshness_registry.json`
One entry per data class: `id`, `label`, `class` (`cron` | `episodic` |
`user-cadence` | `live` | `static`), `artifact` path, `stamp` (how to read the
observed instant — `field` pointer or `literal`), `cadence`, `stalenessBudgetHours`,
`refreshWorkflow`, and `gate`. It is the single source of truth the table above
is derived from.

### `scripts/check_freshness.mjs`
Reads the registry, resolves each artifact's real observed/generated stamp, and
compares age against budget. Prints a status table and **exits non-zero on any
breach** (`stale`) or broken artifact (`unknown`). This is the owner/ad-hoc gate.
Plain Node ESM, dependency-free — it mirrors `lib/freshness.ts`'s tiny rules the
same way `validate-data.mjs` mirrors the app's row rules.

### Wired into `validate-data` as a **WARN, not a fail**
Schema validation is a build gate — a malformed dataset must block a merge.
Cadence is different: a daily cron whose review PR hasn't merged yet, or a source
still waiting on a provider key, is **stale-but-valid**. Blocking a *code* merge
on that would be wrong, so `validate-data` only WARNs on freshness breaches; the
hard non-zero gate is the dedicated `check_freshness.mjs`. (The hook is a
resilient dynamic import so the "single script copies into a scratch repo"
contract the validation tests rely on still holds.)

### `GET /api/freshness`
Read-only route returning the registry resolved against live stamps + a status
summary, with edge cache headers (`s-maxage=300, stale-while-revalidate=1800`,
the house pattern; no `jsonCached` helper exists on main yet). Never 500s — a
missing artifact is that dataset's own `unknown` status, not a route failure. The
site can render honest freshness anywhere from this one endpoint, feeding the
`lib/dataFreshness.ts` label idioms uniformly.

**Status vocabulary:** `live` (served per request), `fresh` (within budget),
`stale` (breach — owner-visible), `untracked` (intentionally not budgeted —
static/episodic/user-cadence), `unknown` (expected a stamp, artifact missing/broken).

### What the spine reports right now
The three daily crons (night signals, weather, What's-On) currently read
**stale** against a 48 h budget — their last review PRs are 2.5–7 days old. That
is the feature working: the directive "always get live data" now has a dial that
says out loud when a cadence has slipped.
