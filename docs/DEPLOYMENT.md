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
| `ADMIN_TOKEN` | Moderator auth for `/admin` and moderation APIs. Sent as the `x-admin-token` header. If unset, moderation is open **only** in dev/test (`NODE_ENV`) — always set it anywhere reachable, including preview deployments. |
| `RATE_LIMIT_SALT` | Salt for `sha256(salt:ip)` IP hashing (raw IPs never reach the DB or logs). Defaults to a public constant in dev — set a secret in production so hashes aren't computable from public code. |

### Optional — The Landlord (heritage Q&A)

| Var | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Enables narrated LLM answers via OpenRouter. Without it, `/api/heritage` returns the grounded, structured-only fallback (reads the facts back, never invents). |
| `OPENROUTER_MODEL` | Model id. Defaults to `anthropic/claude-sonnet-5`. |

## Supabase setup

### 1. Run the migrations, in order

Apply the SQL in `supabase/migrations/` **in numeric order** (each builds on the last):

| File | What it creates |
|---|---|
| `0001_visit_reports.sql` | Pint Drops table + RLS (service-role writes, public read of visible rows only). |
| `0002_pub_heritage.sql` | `pub_heritage` facts table (one row per fact), keyed by `venue_key`; public read-only. |
| `0003_rate_limits.sql` | `rate_limits` table + `check_rate_limit` RPC (atomic durable rate limiting). |
| `0004_report_pint_drop.sql` | `report_pint_drop` RPC — atomic increment-stamp-hide so concurrent reports can't lose a count. |

Run each via the Supabase SQL editor, or with the Supabase CLI (`supabase db push` / `supabase migration up`) pointed at the project.

### 2. Create the storage bucket

Buckets are not SQL objects, so create it **out of band** (Supabase dashboard → Storage, or the Management API):

- Name: **`pint-drops`** (or whatever `SUPABASE_STORAGE_BUCKET` is set to).
- **Public read** — photo URLs are served publicly (paths are UUID-based and unguessable).

> Note: the public bucket serves any object whose URL is known, including objects belonging to hidden drops (the DTO withholds URLs for hidden rows, but a previously-shared URL still resolves). A real takedown flow needs a private bucket + signed URLs. Fine for the demo; flagged for real public UGC.

## Continuous integration and deployment checks

`vercel.json` sets the build command to the full gate:

```json
{ "buildCommand": "npm run ci" }
```

So **every Vercel deploy runs `npm run ci` = lint · typecheck · Vitest · Next build**. If any step fails, the deploy fails and production is never updated — this is the automatic CI/CD gate.

GitHub Actions is intentionally **manual-only** right now. GitHub accepts the workflow, but GitHub-hosted runs fail before job allocation on this private repo (`startup_failure` with zero jobs and no logs). That is a runner/account allocation problem, not a product-code problem. Keeping the workflow manual-only prevents every merge from producing a red Actions run while Vercel remains the enforced deploy gate.

When GitHub Actions runner allocation is fixed, re-enable `push` and `pull_request` triggers in `.github/workflows/ci.yml`. The workflow itself is intentionally boring:

- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

The workflow supports `workflow_dispatch`, so it can be rerun manually from GitHub Actions after account/runners are fixed.

### Known GitHub check sources

The latest code-level gate is healthy locally and on Vercel. If GitHub shows red checks, identify which app owns the failure before changing product code:

| Check source | What it means | Fix path |
|---|---|---|
| `CI / Verify and build` | First-party GitHub Actions workflow from `.github/workflows/ci.yml`. Manual-only until GitHub runner allocation is fixed. | Do not treat automatic absence as a failure. If a manual run still reports `startup_failure` with zero jobs, fix GitHub account/runners/settings rather than product code. |
| `Vercel` | Automatic deployment gate. Runs `npm run ci` before deploy. | Fix code/build/env, then redeploy. |
| `Supabase Preview` | Supabase GitHub integration. | If it says `Remote migration versions not found in local migrations directory`, sync migration history: pull/export the missing remote migrations or repair the Supabase migration table so remote and `supabase/migrations/` agree. Do not delete local migrations to make this pass. |
| GitHub Actions `startup_failure` | GitHub failed before allocating a job. GitHub shows no jobs and no logs. | It is not a code test failure. Keep Actions manual-only and use Vercel as the automatic gate until account/runners/settings are fixed. |
| `Greptile Review` | External AI review/check app. | Treat as code-review signal, not a build gate. Address concrete findings in PR comments. |
| `dbt Cloud`, `starslingdev`, other queued app suites | External GitHub Apps attached to the repo. | Disable unused apps or remove them from required checks; they are not part of PubMaxing's build unless explicitly configured. |

### Agent workflow for Codex / Opus

Before pushing a branch:

1. Run `npm run ci` locally.
2. Commit only product/docs changes, not local agent state such as `.agents/`, `.claude/`, `.mcp.json`, `.playwright-mcp/`, or skill inventory files.
3. Push the branch.
4. Check `gh pr checks <pr-number>` if a PR exists.
5. Treat Vercel failures as blockers. Treat Supabase Preview and Greptile as separate integration/review queues.

## Trust boundary: `x-forwarded-for`

Rate-limit IPs come from the `x-forwarded-for` header (`lib/supabase.ts` → `clientIp`), which is **client-suppliable**. This is safe **only** because Vercel's edge normalises the header (left-most entry = the real client). The IP is a *secondary* limiter signal — write keys lead with the contributor handle — so a spoofed header only widens one actor's own budget.

**A self-hosted deployment must front the app with a trusted proxy** that overwrites `x-forwarded-for`. Do not trust the header behind an untrusted network.
