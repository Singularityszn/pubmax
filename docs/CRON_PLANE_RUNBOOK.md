# Cron freshness plane — owner runbook

A scheduled **freshness plane on Vercel Cron** that keeps live data fresh:
weather, the What's-On tonight window, permissible-source price retrieval,
Night Signal candidates, and a rotating UK city pub-enrichment sweep. It is
additive and fail-soft — every piece
degrades loud-but-soft (log + skip) and never fabricates data.

> **GitHub Actions is retired.** This plane replaces it. Do not add or suggest a
> `.github/workflows/*` schedule — Actions billing is dead and out of scope.

---

## What runs, when

Vercel Cron invokes each route with `Authorization: Bearer $CRON_SECRET`. Crons
run on **production deployments only**. Schedules are **UTC** (Vercel Cron has no
DST awareness); the London mapping is spelled out because `vercel.json` is strict
JSON and cannot carry inline comments.

| Route | Schedule (UTC) | London (BST / GMT) | Purpose | maxDuration |
|---|---|---|---|---|
| `GET /api/cron/refresh-weather` | `0 */6 * * *` | 01:00·07:00·13:00·19:00 / 00:00·06:00·12:00·18:00 | Fetch Open-Meteo for every night area → durable `weather_snapshots` store | 60s |
| `GET /api/cron/refresh-whats-on` | `0 14 * * *` | **15:00** / 14:00 | SLIM: revalidate the servable tonight window + stamp `feed_freshness` (pre-evening) | 60s |
| `GET /api/cron/refresh-prices` | `0 7 * * 1` | 08:00 / 07:00 | Retrieve and validate permissible-source rows; stamp only when valid rows exist | 60s |
| `GET /api/cron/freshness-audit` | `30 6 * * *` | 07:30 / 06:30 | Read the freshness spine, report stale feeds and unresolvable feeds as two separate findings (console only) | 30s |
| `GET /api/cron/refresh-night-signals` | `15 5 * * *` | 06:15 / 05:15 | Exa sweep for PENDING Night Signal candidates + freshness stamp — never publishes; human review still gates the feed | 60s |
| `GET /api/cron/enrich-city-pubs` | `15 3 * * *` | 04:15 / 03:15 | Rotating Tavily official-page discovery for one UK city batch (`lib/tavilyPubEnrichment.server.ts`) — structured observations to logs only; a function cannot commit repository files | 120s |

The What's-On slot is chosen to land **before the evening** in London. In BST
(summer) `14:00 UTC = 15:00 London`; in GMT (winter) it fires at `14:00 London`,
one hour earlier — still pre-evening, which is the intent. If you ever need it
pinned to exactly 15:00 year-round, you must flip the schedule seasonally
(`0 14` in summer, `0 15` in winter) — Vercel cannot do it automatically.

---

## One-time setup checklist

1. **Set `CRON_SECRET`** on the Vercel project (Production, and Preview if you
   want to test there):
   - Generate a strong random value, e.g. `openssl rand -hex 32`.
   - `vercel env add CRON_SECRET production` (or via the dashboard →
     Settings → Environment Variables).
   - Vercel automatically attaches it as the `Authorization: Bearer` header on
     cron invocations. Each route **also** re-checks it (defence in depth), so a
     direct hit to `/api/cron/*` without the secret gets `401`. **If
     `CRON_SECRET` is unset in production the routes refuse to run** (`401
     CRON_NOT_CONFIGURED`) rather than exposing an unprotected mutating endpoint.

2. **Apply migration `0047`** (`supabase/migrations/20260721130000_0047_cron_freshness_plane.sql`):
   - It is **additive-only**: two new tables (`weather_snapshots`,
     `feed_freshness`), RLS on, service-role only, no change to any existing
     object, no functions (so no `search_path` to pin).
   - Apply loudly via the Supabase MCP or `supabase db push`, then run the
     **advisor pass** (security + performance lints).
   - **Until it lands, nothing breaks:** the stores fail soft to process-memory
     and the read side falls back to the committed
     `public/data/weather/latest.json`. Weather becomes durable the moment the
     table exists — no code change.

3. **Confirm the existing Supabase env** is present (already required by the app):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Without them the cron writes to
   process-memory only (ephemeral per instance) and the read side serves the
   committed file — the plane still runs, just not durably.

---

## Which keys enable which feed

| Feed | Provider | Env key(s) | Behaviour without the key |
|---|---|---|---|
| **Weather** | Open-Meteo | **none** (keyless) | Always runs. No skip branch. |
| **Price updates** | First-party official pages / open data | **none** | Cron runs and logs an honest no-op. Freshness remains unchanged until a real source parser returns valid rows. |
| What's-On — baseline scrape | Exa / Firecrawl (ingest agents) | `EXA_API_KEY`, `FIRECRAWL_API_KEY` | Full ingest is **out-of-function** regardless (see below); slim cron logs the absent keys and skips. |
| What's-On — events vertical | Ticketmaster / Skiddle | `TICKETMASTER_API_KEY`, `SKIDDLE_API_KEY` | Provider noop-skips; slim cron logs the absent keys. Skiddle also needs **written commercial approval** (email dev@skiddle.com) before use. |
| Events (later) | Ticketmaster Discovery | `TICKETMASTER_API_KEY` | Free instant key; lights up the events vertical when full ingest is wired. |
| **Night Signals — candidates** | Exa | `EXA_API_KEY` | Cron logs the absent key and no-op skips; candidates stay wherever the last sweep left them. |
| **UK city pub enrichment** | Tavily (discovery only — never provenance; see `data/price_sources.json`) | `TAVILY_API_KEY` | Cron is an honest no-op (`skipped: "no-tavily-key"`). Set as a Vercel secret. |

Owner provides keys as they are secured; a missing key is **logged and skipped**,
never faked.

---

## Human review boundaries

Vercel owns machine scheduling, not publication. Price source retrieval can
stamp `price_updates` only after at least one valid attributed row is fetched.
Current source parsers return no rows, so scheduled runs leave old freshness in
place and production keeps showing real staleness. Publishing retrieved rows
still needs the manual reviewed artifact path in `scripts/refresh_prices.mjs`.

Night Signal candidate ingestion is separately machine-scheduled. It never
publishes reviewed `night_signals`; approved human publication remains the only
way that snapshot advances. For that reason reviewed feed is episodic and has no
machine staleness budget.

---

## Why What's-On is SLIM (the honest limitation)

The **full** What's-On ingest genuinely cannot run inside a serverless cron:

- **Baseline verticals** (sport / quiz / deals / music) are aggregated by
  `scripts/refresh_whats_on.mjs` **from pre-scraped agent outputs on disk**.
  There is no scraper agent inside a Vercel function, and the output is a
  committed file the **read-only serverless filesystem cannot write**.
- **Events vertical** (`scripts/whatson/eventsRefresh.mjs`) needs provider keys
  **and** likewise overwrites a committed file it cannot persist in-function.

So the cron does the slim, honest thing it **can** do in a function: it
**revalidates the servable tonight window** (baseline blended with live CityMCP
at request time — the exact path the app serves) and writes a durable
`feed_freshness` stamp so `/api/freshness` reports an **honest observedAt**
instead of the frozen `generatedAt` of the committed baseline file.

**Alternatives for a true full ingest** (pick when it matters):

1. **Local / manual** `npm run whats-on-refresh` and `npm run refresh:events`,
   committed via the existing `--open-pr` flow (what happens today).
2. A **separate long-running worker** (a small container / a Supabase Edge
   Function with a writable target) that scrapes and writes rows to a durable
   table the store reads — the same store seam weather now uses. This is the
   clean path if/when full ingest must be unattended; it is out of scope here.
3. **Ticketmaster-only events** in-function: a keyed, fetch-only ingest that
   writes rows to a durable `whats_on` table (not a committed file). Feasible in
   a function once `TICKETMASTER_API_KEY` is set — a future lane.

---

## TfL disruption needs NO cron

`lib/tflDisruption.ts` (route `/api/tfl-disruption`) is **live-per-request with a
5-minute server-side revalidate** (Next data cache). It fetches TfL Line Status,
filters to material disruptions overlapping tonight, and renders nothing when
clear. There is **no disk artifact to age** and nothing to schedule — a cron
would only duplicate the live path. Same for `/api/last-train` and friends
(keyless, live). Do not add a cron for these.

---

## Verifying a cron ran

- **Vercel dashboard → Project → Cron Jobs**: each job lists its last run,
  status, and duration. A `200` with `{ ok: true, ... }` body is success.
- **Logs**: filter Runtime Logs for the tags
  `[cron:refresh-weather]`, `[cron:refresh-whats-on]`,
  `[cron:refresh-prices]`, `[cron:freshness-audit]`,
  `[cron:refresh-night-signals]`, `[cron:enrich-city-pubs]`.
  - Weather success: `wrote N observations at <iso> (skipped M)`.
  - What's-On success: `revalidated tonight window: N rows at <iso>`.
  - Price no-op: `fetched no rows; freshness unchanged`.
  - Price success: `retrieved N valid row(s), observed at <iso>`.
  - Audit: `all tracked feeds within budget.`, or one or both of two DIFFERENT
    alerts. `N feed(s) breaching freshness budget` means the data is old and a
    refresh job owes us a run. `N feed(s) whose age could not be determined`
    means the audit could not read the artifact at all and says nothing about
    whether the data is good; each line names the artifact and how it failed.
    A run of unresolvable feeds usually means the function shipped without its
    data files, so check `outputFileTracingIncludes` in `next.config.mjs` before
    suspecting the feeds.
  - Night Signals success: `swept N pending candidate(s) at <iso>`.
  - City enrichment success: a `[city-enrichment]` JSON line with city, cursor,
    queries/credits spent, matched pubs, and extracted prices.
- **Manual trigger** (with the secret):
  ```bash
  curl -sS -H "Authorization: Bearer $CRON_SECRET" \
    https://<prod-domain>/api/cron/refresh-weather | jq
  ```
  Without the header (or with a wrong secret) you get `401` — that is the gate
  working.
- **End-to-end**: after a weather run, `GET /api/freshness` should show the
  `weather` dataset's `observedAt` advance to the store stamp (not the committed
  file's), and `/api/tonight-conditions` serves the fresher reading store-first.

---

## Failure posture (never fake success)

- Weather provider total outage → **`502`**, nothing written.
- Weather payload fails the contract per area → that area is **skipped** and
  reported in `skipped[]`; the surviving areas are still written.
- Durable weather write hard-fails → **`503 STORE_UNAVAILABLE`**, nothing faked.
- Price retrieval returns no valid rows → **`200`**, explicit no-op log, prior
  freshness stamp untouched.
- Price provider failure → **`502 PROVIDER_UNAVAILABLE`**, prior freshness
  stamp untouched.
- What's-On window revalidation throws → logged; the freshness stamp still
  records the attempt time and row count (0 on failure).
- Freshness audit → **never 500s**; a broken artifact surfaces as that dataset's
  own `unknown` status. Alerting is **console-only** today
  (`lib/freshnessNotify.ts` is the seam a later push/alert integration hangs
  off; push delivery is a separate lane and this plane sends none).
- City enrichment Tavily failure → **`502 PROVIDER_UNAVAILABLE`** with an
  `[ALERT]` log; any partial batch already processed is logged as a
  `[partial]` line (progress observations stream per pub, so a mid-batch
  failure never loses what was found).
