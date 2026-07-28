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
| `ADMIN_TOKEN` | Moderator auth for `/admin` and moderation APIs. Prefer the httpOnly session cookie from `POST /api/admin/session` (the admin console never needs to keep sending the raw token). The `x-admin-token` header remains accepted for scripts/back-compat. If unset, moderation is open **only** in dev/test (`NODE_ENV`) — always set it anywhere reachable, including preview deployments. **Required in production:** `assertServerEnv()` refuses to start if this is unset (FATAL at route import). |
| `RATE_LIMIT_SALT` | At least 32 random bytes for `sha256(salt:ip)` IP hashing (raw IPs never reach the DB or logs) and the fallback trusted Plan-signing key. Defaults are allowed only for non-trusted local helpers. **Required in production:** `assertServerEnv()` refuses to start if this is unset, short, or still the dev default. |

### Optional — The Landlord (heritage Q&A)

| Var | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Enables narrated LLM answers via OpenRouter. Without it, `/api/heritage` returns the grounded, structured-only fallback (reads the facts back, never invents). |
| `OPENROUTER_MODEL` | Model id. Defaults to `anthropic/claude-sonnet-4-5`. |

### Optional — other integrations

| Var | Purpose |
|---|---|
| `PLAN_IDEMPOTENCY_SECRET` | Optional dedicated HMAC secret of at least 32 random bytes for retry-safe Plan writes, grounding proofs, and verified loop analytics. When omitted, the required `RATE_LIMIT_SALT` is used. A configured short value fails startup/signing rather than silently falling back. |
| `EXA_API_KEY` | Powers the scheduled signals-ingestion job (sol.md TL-6). If unset, that job is skipped; the interactive app path does not depend on it. |
| `TAVILY_API_KEY` | **Server-only** key for the rotating UK city pub-enrichment cron (`/api/cron/enrich-city-pubs`) and `npm run enrich:city`. Set as a Vercel secret. If unset, the cron is an honest no-op (see `docs/CRON_PLANE_RUNBOOK.md`). |
| `TFL_APP_KEY` | Optional TfL app key for every TfL read (`/api/last-train`, `/api/nearby-bus-departures`, via `lib/tflClient.server.ts`). The keyless TfL API is used by default; the key is only appended when present (higher rate limits). |
| `ACTOR_HASH_SALT` / `PLAN_MEMBER_TOKEN_SALT` | Extra identity-hash salts. Both fall back safely (`ACTOR_HASH_SALT` → `RATE_LIMIT_SALT`; `PLAN_MEMBER_TOKEN_SALT` → `ACTOR_HASH_SALT`). Set distinct secrets in production. |

### Keyless signing boundary

Non-production local demos with no Supabase and no signing secret use a
cryptographically random process-local HMAC key. This keeps Plan grounding and
verified analytics usable in the same in-memory process without creating a
public forgeable key; tokens intentionally stop verifying after restart. Any
`NODE_ENV=production`, deployed, or Supabase-backed process must configure one
of the trusted secrets above. `PUBMAX_E2E_KEYLESS=1` selects only the in-memory
storage backend; it never relaxes signing. `playwright.config.ts` injects a fresh
32-byte `PLAN_IDEMPOTENCY_SECRET` through `webServer.env` for each
production-style browser-test run, keeping it out of the command and argv.
Plan generation, creation, and completion return retryable
`PLAN_SIGNING_UNAVAILABLE` (503) before mutation when that boundary is
misconfigured.

### Vercel-injected (do not set by hand)

| Var | Purpose |
|---|---|
| `VERCEL_OIDC_TOKEN` | Minted and injected by the Vercel CLI / build (`vercel env pull`, `vercel dev`) for OIDC federation. Not read by application code in this repo — documented here so its origin is clear; do not set it manually. |

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
- **Private bucket** — public read is disabled. The server emits short-lived signed URLs via `resolveStorageUrl` / `createSignedUrls` in `lib/pintDropsStore.ts` and deletes Storage objects on hide/moderation takedown.

> **Storage takedown:** hidden drops return `null` photo URLs in DTOs; `deletePhotos` runs when a drop is moderated hidden or auto-hidden by reports so a previously shared signed URL cannot be reissued after takedown. The bucket must stay **private** so raw object URLs never resolve without a fresh signature.

### Social privacy boundary

- Public clients must use `/api/*` DTOs only. Social tables are RLS-protected (deny-all or public-read of non-sensitive columns); service-role writes stay server-side.
- Mutable social/admin responses use `Cache-Control: no-store` via `jsonNoStore` (`lib/apiResponses.ts`) so private inboxes and ownership-gated writes are never CDN-cached.
- Hidden Pint Drop photos: DTOs null out URLs; Storage objects are deleted on takedown; bucket must be private (see Storage bucket note above).

### 3. Browser sign-in (email magic link + Google + Microsoft)

The app calls Supabase Auth with `signInWithOtp` for passwordless email and `signInWithOAuth` for Google/Microsoft. All three finish the PKCE exchange at the canonical site's `/auth/callback`, then return to the path where sign-in started. The callback rejects absolute, protocol-relative, and backslash redirect targets; never add a client-controlled redirect that bypasses that seam. URL fragments are never copied into Supabase's `redirectTo`: the browser holds them in a TTL-limited record keyed by a cryptographically random attempt ID and restores them only for the matching return path, because Plan invite fragments contain one-use capabilities. Supabase uses one browser PKCE verifier per project, so the app atomically allows only one live attempt across tabs through the Web Locks API and gives an honest error instead of overwriting another tab's attempt. The initiating tab also records its attempt in `sessionStorage`, allowing an explicit retry after backing out of the provider without weakening cross-tab isolation. Persistent browser storage and the Web Locks API are required for this PKCE coordination; browsers that disable either fail closed with an actionable message because an in-memory verifier cannot reliably survive the provider's full-page round trip. Secrets stay in the Supabase dashboard - the Next.js app only needs the public URL + publishable key above.

#### Shared Supabase URL config

Dashboard → Authentication → URL Configuration:

| Setting | Value |
|---|---|
| Site URL | `https://pubmaxxing.com` (canonical production apex) |
| Redirect URLs | `https://pubmaxxing.com/auth/callback`, `http://localhost:3000/auth/callback` |

Set `NEXT_PUBLIC_SITE_URL=https://pubmaxxing.com` in every deployed Vercel
environment, including previews. Deployed auth always requests the apex
callback, so do not allowlist `*.vercel.app`, preview hosts, or `www`. A rejected
`redirectTo` makes Supabase fall back to Site URL. If Site URL points at a
deployment host, an email link lands there without the initiating origin's PKCE
verifier and sign-in cannot complete.

These controls solve different problems:

- Vercel Deployment Protection is access control. The Vercel Authentication
  scope **Production Deployment URLs and All Preview Deployments** keeps the
  custom production domain public while protecting deployment URLs and
  previews. Configure it in Vercel Project Settings under Deployment
  Protection. Signed-in team members can still open protected URLs. Other
  reviewers need a temporary share link, and automated checks need an
  automation bypass secret.
- A permanent host redirect is canonicalisation, not access control. Redirecting
  only `chengdu-pubmax69.vercel.app` to the apex stops that named host serving an
  independent copy while leaving other preview URLs usable for review. Cost:
  that alias can no longer show its deployed build, and it remains reachable
  enough to issue the redirect. A wildcard redirect for every `.vercel.app`
  hostname also makes every preview unusable because it immediately leaves for
  production.

Recommendation: retain that Vercel Authentication scope, keep `www` redirecting
to the apex, keep all identity-provider callbacks on the apex, and add an exact
host redirect for `chengdu-pubmax69.vercel.app`. That combination blocks
anonymous access and removes the named alias for signed-in Vercel users without
breaking other previews. Do not apply the redirect to all preview hosts unless
losing preview review is an accepted trade-off.

#### Passwordless email (magic link)

1. Supabase → Authentication → Providers → **Email**: enable Email and confirm-password/email links. The app intentionally calls `shouldCreateUser: true`, so a valid first-time address creates an account through the same flow.
2. Supabase → Project Settings → Auth → SMTP: configure a production sender, verified domain, and reply-to address. Supabase's development sender is not a production delivery guarantee. Review the dashboard's email rate limits against expected launch traffic.
3. Authentication → Email Templates → **Magic Link**: keep the action URL based on `{{ .ConfirmationURL }}`. The current PKCE browser client expects Supabase to return a `?code=` to the allowlisted `/auth/callback`; a custom `token_hash` template needs a separate server-cookie verification route and must not be switched on silently.
4. Make the template name PUBMAXX, state that the link signs the recipient in, include an expiry/help line, and do not include account-existence language. Test delivery, expiry, duplicate clicks, a new address, an existing address, and spam placement before launch.

The UI deliberately gives the same success message for every address and replaces provider failures with normalized retry/rate-limit copy. This prevents the client from becoming an account-enumeration oracle. Supabase remains the enforcement point for actual email sending and rate limits.

**Wrapped shell / deep links:** the current Capacitor app is a remote-URL shell and the magic link is HTTPS, so the callback is safe and usable in the browser that receives the email. PKCE requires the browser containing the code verifier. If a mail app opens the link in a different browser context, including outside the shell, that context may not complete the exchange. Native return-to-app auth therefore remains an owner/configuration item: verified Associated Domains/Android App Links plus an auth-specific handoff must be designed and device-tested before claiming in-shell magic-link completion. Do not change the dashboard redirect to a custom scheme; the web callback and existing universal-link seam are the safe starting point.

Vercel must attach both `pubmaxxing.com` and `www.pubmaxxing.com` to the same production project, with `www.pubmaxxing.com` permanently redirecting to the canonical apex. After an explicitly authorised deployment, verify that the apex returns the release, the `www` redirect preserves the path and query string, and both TLS certificates are valid:

```sh
curl -sSIL https://pubmaxxing.com/map
curl -sSIL 'https://www.pubmaxxing.com/map?sel=venue-xjf3n0'
```

#### Google

1. Google Cloud Console → create an OAuth client (Web).
2. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback` (and optionally your site callback if you also list it there).
3. Supabase → Authentication → Providers → **Google** → paste Client ID + Client Secret → Enable.

#### Microsoft (Outlook / Entra)

Supabase’s provider id is **Azure** (the app code uses `provider: "azure"` with `scopes: "email"`).

1. Microsoft Entra admin center → App registrations → New registration.
2. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (so Outlook/Hotmail work, not only work tenants).
3. Redirect URI (platform **Web**): `https://<project-ref>.supabase.co/auth/v1/callback` only — the IdP must redirect to Supabase, not the Next.js `/auth/callback`.
4. Certificates & secrets → create a client secret; copy the **Application (client) ID** and the secret value.
5. API permissions → Microsoft Graph → Delegated: `openid`, `profile`, `email`, `User.Read` (grant admin consent if your tenant requires it). Without `email`, Supabase often fails with “Error getting user email from external provider”.
6. Token configuration → optional claims → ID token: add `email` and `xms_edov` (helps Supabase treat email as verified and avoid unsafe account linking).
7. Supabase → Authentication → Providers → **Azure** → paste Client ID + Client Secret → Enable. Leave Tenant URL / ID as the default “common” multi-tenant endpoint unless you intentionally lock to one tenant.

Until a provider is enabled in Supabase, its button opens the IdP and then fails the redirect — that is expected dashboard setup, not an app bug. The nav shows both Google and Microsoft whenever the public Supabase env is set; enable each provider when you are ready.

## Build-time data artifacts

`npm run prebuild` regenerates the browser data packs and the server-only venue
detail pack:

| Output | Role |
|---|---|
| `public/data/venues_slim.json` | Map pins + filter hints (shipped to clients). |
| `public/data/uk_base/` | Deferred, viewport-streamed unverified UK pub layer. See its README for the delivery contract. |
| `data/generated/venue_detail_index.json` | Byte-offset manifest for lazy detail reads. |
| `data/generated/venue_details.jsonl` | Per-venue detail payloads: pub price rows or curated venue facts (not committed). |

Do not commit the `data/generated/` detail binaries. Vercel/CI regenerates all
build-time packs via `prebuild`; the UK base pack remains committed so first
paint never needs server-side generation. If venue detail artifacts are absent
locally, `lib/venueDetailIndex.ts` falls back to the raw pint dataset plus
`data/famous_venues/` outside production so `/api/venue/[id]` still works in
dev/test.

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

## Identity boundary (demo vs production private actions)

Linked handles are JWT-gated via `gateHandleAction` / `requireLinkedActor`. Unlinked handles still allow the **demo / anonymous self-asserted** path for map drops and similar public writes — that is intentional product behaviour, not a privacy model.

Production private actions that must not be forgeable:

- Messages, notifications, profile edits, crawl story edit/delete
- Comments / list-follows when the handle is linked
- Friends-lane visibility (JWT viewer only; `?viewer=` ignored in production)
- Admin moderation (httpOnly session cookie)

See `lib/profileOwnership.ts` header comment for the exact decision table.

## Trust boundary: `x-forwarded-for`

Rate-limit IPs come from the `x-forwarded-for` header (`lib/supabase.ts` → `clientIp`), which is **client-suppliable**. This is safe **only** because Vercel's edge normalises the header (left-most entry = the real client). The IP is a *secondary* limiter signal — write keys lead with the contributor handle — so a spoofed header only widens one actor's own budget.

**A self-hosted deployment must front the app with a trusted proxy** that overwrites `x-forwarded-for`. Do not trust the header behind an untrusted network.
