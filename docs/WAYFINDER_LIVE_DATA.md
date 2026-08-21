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
Every fact carries `{source, observedAt}`; scheduled jobs never fabricate
freshness, and human-reviewed artifacts still publish through a review PR. The
freshest possible cadence is bounded by what the *honest* source (first-party
page, official API, open data) supports.

---

## 1. Cadence table

| Data class | Current source | Refresh path (today) | Actual cadence today | Gate | Freshest honest cadence | Staleness budget |
|---|---|---|---|---|---|---|
| **TfL last-train / last-drink** | `api.tfl.gov.uk` (keyless) | `app/api/last-train` fetches **per request** through the shared `lib/tflClient.server.ts` client, never disk-cached | Live | none (`TFL_APP_KEY` only raises limits) | Live (real-time arrivals) | live |
| **TfL nearby bus departures** | `api.tfl.gov.uk` (keyless) | `app/api/nearby-bus-departures` fetches **per request** through the same client: stops inside 500 m, capped at 4, asked concurrently inside one 15 s route budget | Live | none (`TFL_APP_KEY` only raises limits) | Live (real-time arrivals) | live |
| **Weather** | Open-Meteo (keyless) | Vercel `refresh-weather` cron to durable weather store | Every 6 h | none | Every 6 h | 48 h |
| **Night signals** | Staged candidate claims, offline-reviewed | Vercel candidate cron; manual approved publish to `night_signals/latest.json` | Candidate sweep daily; reviewed feed advances only on human publish | `EXA_API_KEY` arms candidate ingestion; **human review always** | Human-gated episodic | untracked |
| **What's-On — baseline** (sport/quiz/deals/music) | Hand-verified first-party rows in `scripts/whatson/*.json` | Vercel slim revalidation + CityMCP blend at request time; full ingest stays manual | Daily slim window; episodic baseline | none | Daily served-window revalidation | 48 h (envelope) |
| **What's-On — events** (Ticketmaster/Skiddle/Context.dev/Common) | Official discovery APIs, the Context.dev registered-source lane (see [`LONDON_HARVEST.md`](./LONDON_HARVEST.md)), plus the Common sitemap reader (facts + link out) | `events-refresh.yml` on `main` (daily 04:00 UTC, validates before it opens the review PR) and the local launchd events job; `/api/out` also supplements the bundled file live per request | Daily GitHub workflow and local scheduler | `TICKETMASTER_API_KEY`, `SKIDDLE_API_KEY` and/or `CONTEXT_DEV_API_KEY` (Skiddle also stays fenced off until we hold its logo); the Common lane is keyless | Daily 04:00 UTC | 48 h |
| **Pint prices (core dataset)** | Collected July 2026 snapshot | Manual `export:data → canonicalize:venues → build:slim` | Episodic (bundled static) | none | Re-collection cadence (manual) | 90 d |
| **Price updates (cheapest pint)** | First-party / open sources allowlist | Manual reviewed publish to `price_updates/latest.json`; the weekly Vercel `refresh-prices` cron only retrieves and stamps the separate `price_update_retrieval` feed | Episodic — parser stub keeps the served envelope empty; `generatedAt` names the bundled pint collection day until a reviewed publish lands | none to run; needs a per-source parser | Publish-bound serving once parsers ship | untracked |
| **Drink price updates** | Wetherspoons first-party (allowlist) | `Drink price refresh` workflow → `refresh:drink-prices` → PR | **Weekly Mon 07:30 UTC** — pipeline real but **emits 0 rows** (no per-drink web prices; prices live only in the Order-&-Pay app backend) | none to run; source has no permissible per-drink prices | Weekly | 14 d |
| **Food price updates** | Menu harvest | Manual harvest (no workflow) | Episodic | `FIRECRAWL_API_KEY` for scraping | Episodic | 60 d |
| **Pint Index (borough medians)** | Confirmed Pint Drops + official-publisher / open-data | Recomputed as eligible observations arrive | **Event-sourced** (grows with the product) | none | User-cadence — **the growth loop IS the refresh** | untracked |
| **Late-food evidence** | Hand-evidenced per Night Area | Manual curation | Episodic | none | Episodic | untracked |
| **Venue presence (Wetherspoons/OSM)** | OSM Overpass + directory | `fetch:city-pubs` / `fetch:uk-pubs` / `fetch:uk-venues` / `fetch_wetherspoons_pubs.mjs` (manual); the venue packs and their London publish carry no registry entry yet, so the spine can call them neither fresh nor stale ([`VENUES.md`](../data/osm/uk/VENUES.md)) | Episodic | `FIRECRAWL_API_KEY` for directory path; OSM keyless | Episodic (OSM changes slowly) | untracked |
| **PUBMAXXING all-drinks / history seed** | Sibling `pubmaxxing` repo | Manual `build:pubmaxxing-seed` import | Episodic | none | Per-import | untracked |
| **CityMCP (buzz/status/journey/places)** | `citymcp.com/london/mcp` (keyless) | Proxied **per request**, short in-process TTLs (3–10 min) | Live | none (buzz quality rides CityMCP's own EXA-backed enrichment) | Live | live |
| **Buzz digest** | CityMCP `get_place` deep synthesis | `app/api/citymcp/buzz` per request | Live but **content is EXA-blocked upstream** — returns `{buzz:null}` when CityMCP has no digest | none locally; upstream EXA-gated | Live | live |
| **TfL line geometry / London POIs** | Curated GeoJSON | Manual | Static | none | Rarely changes | untracked (static) |

**Not a class in this table: historical pint prices.** `public/data/price_history/london.json`
is dated evidence about the past, so it has no cadence and no staleness budget to
breach, and it is deliberately absent from `data/freshness_registry.json` rather
than registered as `static`. It may never reach a current-price surface at all.
Its contract is owned by
[`public/data/price_history/README.md`](../public/data/price_history/README.md).

**Not a class in this table either: national pint benchmarks.** The cited UK
figures shown on `/pint-index` (`lib/nationalPintBenchmarks.ts`) are other
publishers' measurements, hand-curated and carried in code with a publisher, a
public link and a publication day each. We do not refresh them, so they have no
cadence and no staleness budget of ours to breach, and they are deliberately
absent from `data/freshness_registry.json`. They may never be aggregated with our
own prices or reach a current-price surface, and they never appear on a dated
edition. The rule lives at the top of that module.

---

## 2. Activation matrix — which owner key arms which refresh

The freshest cadence for several classes is **latent**: the pipeline is built
and safe-no-op today, and lights up with **no code change** the moment the owner
sets a secret. Exact env var → mechanism mapping:

| Env var / secret | Where it's set | What it arms | Effect when **absent** (today's reality) |
|---|---|---|---|
| `EXA_API_KEY` | Vercel env | Night-signal candidate ingestion (scheduled) | Candidate sweep skips without changing reviewed snapshot; nothing in interactive path breaks |
| `TICKETMASTER_API_KEY` | Read from the GH Actions secret by the refresh, from the Vercel env by `/api/out`, and from the local key file by the launchd job | What's-On **events** vertical (Ticketmaster Discovery), in the refresh and in the `/api/out` live supplement | Lane reports `not-configured`; contributes 0 rows, and a reader is never told the market is empty |
| `SKIDDLE_API_KEY` | Same three readers; **not provisioned anywhere yet** | What's-On events (Skiddle) — **also needs written commercial approval from dev@skiddle.com**, and the lane stays fenced off until we hold the Skiddle logo the licence requires | Lane reports `not-configured` |
| `CONTEXT_DEV_API_KEY` | Local key file read by the launchd events job; not a GH Actions or Vercel secret | What's-On events, registered-source lane only - allowed first-party venue-events pages in `lib/harvest/sourcePolicy.ts`, read through Context.dev extract ([`LONDON_HARVEST.md`](./LONDON_HARVEST.md)) | Lane reports `not-configured` and sends nothing |
| `FIRECRAWL_API_KEY` | Local `.env` / CI secret | Menu scraping (food prices), Wetherspoons directory refresh, research | Those harvest scripts can't fetch; bundled data unaffected |
| `TFL_APP_KEY` | Vercel env | Higher TfL rate limits | Every TfL surface (last-train, nearby buses) works fully keyless; only limits are lower |
| `OPENROUTER_API_KEY` | Vercel env | The Landlord heritage narration | `/api/heritage` returns grounded, structured-only answers |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST` | Vercel env | Consent-gated PostHog EU product analytics with persistent pseudonymous device identity, standard browser context, coarse pageviews, Web Vitals, and scrubbed browser exceptions | Product events still logged to Vercel structured sink |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_PUB_PAL_AGENT_ID` | Vercel env | Pub Pal conversational voice token | Voice session unavailable |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Vercel env (required in prod) | Pint Drops persistence, moderation, durable rate limiting | Pint Drop writes 503; in-memory demo store locally |

Vercel schedules are owned by `vercel.json` and run on production deployments.
Provider-gated jobs activate when their Vercel secret exists. The events refresh
is a GitHub Actions workflow that opens a review PR, not a production schedule:
it commits nothing to `main` on its own.

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
2. **Price / drink-price parsers are stubbed or dry.** Weekly price cron runs on
   Vercel, but shared `fetchFromSource` returns `[]` (no parser yet), so it logs
   a no-op and leaves freshness unchanged. Drink source (Wetherspoons) exposes
   **no per-drink web prices**; prices live only in native Order-&-Pay backend.
   Scheduled retrieval produces zero rows until a permissible parser lands.
   **Gap: real first-party price parsers.**
3. **What's-On events run, but two of the three lanes are held.** The pipeline is
   on `main` and the workflow carries a daily schedule, so the remaining gaps are
   owner actions: switch GitHub Actions on at the repo level, and clear Skiddle
   (written commercial approval plus the logo its credit requires). Ticketmaster
   is keyed, and the Common lane needs no key, so the local scheduler runs it
   whatever the provider keys say.
   **Gap: Actions enabled + Skiddle approval and brand asset.**
4. **Food prices, late-food evidence, venue presence, all-drinks seed → manual,
   episodic.** No workflow. Refreshed by running the harvest/import script by
   hand. These episodic feeds remain
   untracked where their contracts say so.
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

One optional field: `pack: true` says the artifact is a **row pack** whose
presence and non-emptiness is itself a finding, whatever kind of stamp dates it.
A pack that is missing, unparseable or empty resolves to `unknown` rather than
answering its literal stamp, in both readers. It is also the one thing besides a
`field` stamp that opens the artifact at runtime, so `lib/freshnessTracing.mjs`
ships a pack into the freshness functions exactly the way it ships a field stamp
(see the runtime-tracing rule in `AGENTS.md`); an untraced pack would read as
fresh for ever.

### `scripts/check_freshness.mjs`
Reads the registry, resolves each artifact's real observed/generated stamp, and
compares age against budget. Prints a status table and **exits non-zero on any
breach** (`stale`) or broken artifact (`unknown`), listing the two apart under
their own headings: data that is over budget and data whose age could not be
measured are different findings with different owners. This is the owner/ad-hoc gate.
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
`lib/dataFreshness.ts` label idioms uniformly. The response also carries a
`communityPrices` block (the corroborated community-price stock) — that metric
is owned by [`docs/METRICS_FUNNEL.md`](METRICS_FUNNEL.md) §5.

**Status vocabulary:** `live` (served per request), `fresh` (within budget),
`stale` (breach — owner-visible), `untracked` (intentionally not budgeted —
static/episodic/user-cadence), `unknown` (expected a stamp, none could be
resolved). An `unknown` never counts as fresh and never counts as stale: its
`detail` names the artifact and the way the read failed (absent from the
deployment, present but unparseable, present but carrying no stamp field).

### How to read what the spine reports
Current staleness is not written down here - run `node scripts/check_freshness.mjs`
or read `GET /api/freshness`. Two things to know when reading it:

- **Store-backed feeds report the store, not the committed file.** Weather,
  What's-On, and the artifact-less ingestion feeds (`night_signal_candidates`,
  `price_update_retrieval`) surface the durable store's real `observedAt` via
  `lib/freshnessStoreOverlay.ts`, because a serverless cron cannot rewrite a
  committed artifact. An ingestion feed reports that a sweep RAN, never that
  anything shipped.
- **A human-gated feed is `untracked`, not `stale`.** `night_signals` and the
  served `price_updates` envelope advance only on an approved publish (or, while
  parsers are stubbed, carry an honest collection-day stamp with no machine
  budget), so neither reads as a broken weekly cron. The weekly retrieval cron
  stamps `price_update_retrieval` only; it can never quiet or freshen the served
  file.

That is the feature working: the directive "always get live data" has a dial that
says out loud when a cadence has slipped, and stays silent about cadences that
were never machine-owned. The standing per-dataset root causes and the owner
actions they need are owned by
[`docs/FRESHNESS_BURNDOWN_2026-07-24.md`](FRESHNESS_BURNDOWN_2026-07-24.md).
