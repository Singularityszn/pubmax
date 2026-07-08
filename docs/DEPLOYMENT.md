# Deployment runbook

How to deploy PubMaxing to Vercel with Supabase persistence and (optionally) The Landlord. Env var names below are the exact ones the code reads — see `.env.example`, `lib/supabase.ts`, and `lib/heritage.ts`.

The app runs **keyless** locally (in-memory Pint Drops + structured Landlord fallback). Production is different: without Supabase configured, Pint Drop writes intentionally return **503** and admin moderation is unavailable — the store never lies about durability.

## Environment variables

Set these in the Vercel project (Settings → Environment Variables).

### Required in production

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** service-role key. Bypasses RLS — never expose to the client, never commit. |
| `SUPABASE_STORAGE_BUCKET` | Storage bucket name for Pint Drop photos. Defaults to `pint-drops` if unset. |
| `NEXT_PUBLIC_SUPABASE_URL` | Public Supabase URL used by browser auth/realtime. Usually the same value as `SUPABASE_URL`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public browser key for Supabase Auth/Realtime. Safe to expose; do **not** use the service-role key. |
| `ADMIN_TOKEN` | Moderator auth for `/admin` and moderation APIs. Sent as the `x-admin-token` header. If unset, moderation is open **only** in dev/test (`NODE_ENV`) — always set it anywhere reachable, including preview deployments. **Required in production:** `assertServerEnv()` refuses to start if this is unset (FATAL at route import). |
| `RATE_LIMIT_SALT` | Salt for `sha256(salt:ip)` IP hashing (raw IPs never reach the DB or logs). Defaults to `pubmax-rate-limit` in dev — set a unique secret in production so hashes aren't computable from public code. **Required in production:** `assertServerEnv()` refuses to start if this is unset or still the dev default. |

### Optional — The Landlord (heritage Q&A)

| Var | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Enables narrated LLM answers via OpenRouter. Without it, `/api/heritage` returns the grounded, structured-only fallback (reads the facts back, never invents). |
| `OPENROUTER_MODEL` | Model id. Defaults to `anthropic/claude-sonnet-5`. |

## Supabase setup

### 1. Run the migrations, in order

Apply every SQL file in `supabase/migrations/` **in filename timestamp order** (each builds on the last). Do not stop at `0004`; the social demo depends on the later migrations through `0020`.

| File | What it creates |
|---|---|
| `0001_visit_reports.sql` | Pint Drops table + RLS (service-role writes, public read of visible rows only). |
| `0002_pub_heritage.sql` | `pub_heritage` facts table (one row per fact), keyed by `venue_key`; public read-only. |
| `0003_rate_limits.sql` | `rate_limits` table + `check_rate_limit` RPC (atomic durable rate limiting). |
| `0004_report_pint_drop.sql` | `report_pint_drop` RPC — atomic increment-stamp-hide so concurrent reports can't lose a count. |
| `0005`-`0018` | Social layer, auth ownership, notifications, rounds, visibility, comments, realtime publication, drink rows, reports, and followable saved lists. |
| `0019_messages.sql` | Durable conversations/messages with RLS denying raw public table access. |
| `0020_ratings.sql` | Durable drink/pub ratings with raw row access denied; public reads go through aggregate API responses. |

Run each via the Supabase SQL editor, or with the Supabase CLI (`supabase db push` / `supabase migration up`) pointed at the project.

Quick post-migration smoke:

- `POST /api/messages` with `{ "action": "send", "handle": "alice", "other": "bob", "body": "hello" }` returns `201`.
- `POST /api/ratings` with `{ "kind": "venue", "venueId": "venue-16pnwmm", "handle": "alice", "rating": 5 }` returns `200`.
- Anonymous REST reads of raw `conversations`, `messages`, `drink_ratings`, and `venue_ratings` should not expose rows.

### 2. Create the storage bucket

Buckets are not SQL objects, so create it **out of band** (Supabase dashboard → Storage, or the Management API):

- Name: **`pint-drops`** (or whatever `SUPABASE_STORAGE_BUCKET` is set to).
- **Public read** — photo URLs are served publicly (paths are UUID-based and unguessable).

> Note: the public bucket serves any object whose URL is known, including objects belonging to hidden drops (the DTO withholds URLs for hidden rows, but a previously-shared URL still resolves). **Current mitigation:** API DTOs return `null` photo URLs for hidden drops. **Next hardening (planned):** private/quarantine Storage with signed URLs, or delete/move objects on hide/takedown so a previously shared URL stops resolving. Fine for the demo; required before real public UGC.
>
> **TODO (Phase 4 — storage hardening):** migrate the `pint-drops` bucket to private access and serve photos via short-lived signed URLs from API routes; quarantine or delete Storage objects on hide/takedown so previously shared URLs stop resolving. Deferred in the security-hardening wave — too invasive for a single PR alongside session/auth work.

### Social privacy boundary

- Public clients must use `/api/*` DTOs only. Social tables are RLS-protected (deny-all or public-read of non-sensitive columns); service-role writes stay server-side.
- Mutable social/admin responses use `Cache-Control: no-store` via `jsonNoStore` (`lib/apiResponses.ts`) so private inboxes and ownership-gated writes are never CDN-cached.
- Hidden Pint Drop photos: DTOs null out URLs today; private/quarantine Storage is the next takedown hardening step (see Storage bucket note above).

## Continuous integration and deployment checks

`vercel.json` sets the build command to the full gate:

```json
{ "buildCommand": "npm run ci" }
```

So **every Vercel deploy runs `npm run ci` = validate data · lint · typecheck · coverage · Next build**. If any step fails, the deploy fails and production is never updated — this is the reliable automatic gate while GitHub-hosted Actions is unstable.

GitHub Actions is configured for `push`, `pull_request`, and `workflow_dispatch`, but GitHub-hosted runs are currently failing before job allocation on this private repo (`startup_failure` with zero jobs and no logs). That is a runner/account allocation problem, not a product-code problem. Keep the workflow definition boring and use Vercel as the enforced deploy gate until GitHub runner allocation is fixed.

When GitHub Actions runner allocation is fixed, the existing triggers should start producing useful first-party checks. The workflow itself is intentionally boring:

- `npm ci`
- `npm run validate-data`
- `npm run lint`
- `npm run typecheck`
- `npm run coverage` (fails if coverage drops below the vitest.config.ts thresholds)
- `npm run build`

The workflow supports `workflow_dispatch`, so it can be rerun manually from GitHub Actions after account/runners are fixed.

### Known GitHub check sources

The latest code-level gate is healthy locally and on Vercel. If GitHub shows red checks, identify which app owns the failure before changing product code:

| Check source | What it means | Fix path |
|---|---|---|
| `CI / Verify and build` | First-party GitHub Actions workflow from `.github/workflows/ci.yml`. Currently configured for push/PR/manual, but GitHub-hosted runs fail before job allocation. | If a run reports `startup_failure` with zero jobs, fix GitHub account/runners/settings rather than product code. |
| `Vercel` | Automatic deployment gate. Runs `npm run ci` before deploy. | Fix code/build/env, then redeploy. |
| `Supabase Preview` | Supabase GitHub integration. | If it says `Remote migration versions not found in local migrations directory`, sync migration history: pull/export the missing remote migrations or repair the Supabase migration table so remote and `supabase/migrations/` agree. Do not delete local migrations to make this pass. |
| GitHub Actions `startup_failure` | GitHub failed before allocating a job. GitHub shows no jobs and no logs. | It is not a code test failure. Use Vercel as the automatic gate until account/runners/settings are fixed. |
| `Greptile Review` | External AI review/check app. | Treat as code-review signal, not a build gate. Address concrete findings in PR comments. |
| `dbt Cloud`, `starslingdev`, other queued app suites | External GitHub Apps attached to the repo. | Disable unused apps or remove them from required checks; they are not part of PubMaxing's build unless explicitly configured. |

### Agent workflow for Codex / Opus

Before pushing a branch:

1. Run `npm run ci` locally.
2. Commit only product/docs changes, not local agent state such as `.agents/`, `.claude/`, `.mcp.json`, `.playwright-mcp/`, or skill inventory files.
3. Push the branch.
4. Check `gh run list --workflow CI --limit 5` and `gh pr checks <pr-number>` if a PR exists.
5. Treat Vercel failures as blockers. Treat GitHub Actions `startup_failure`, Supabase Preview, and Greptile as separate integration/review queues.

## Trust boundary: `x-forwarded-for`

Rate-limit IPs come from the `x-forwarded-for` header (`lib/supabase.ts` → `clientIp`), which is **client-suppliable**. This is safe **only** because Vercel's edge normalises the header (left-most entry = the real client). The IP is a *secondary* limiter signal — write keys lead with the contributor handle — so a spoofed header only widens one actor's own budget.

**A self-hosted deployment must front the app with a trusted proxy** that overwrites `x-forwarded-for`. Do not trust the header behind an untrusted network.
