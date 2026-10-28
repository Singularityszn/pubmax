# Deployment runbook

How to deploy PubMaxxing to Vercel with Supabase persistence and (optionally) The Landlord. Env var names below are the exact ones the code reads — see `.env.example`, `lib/supabase.ts`, and `lib/heritage.ts`.

The app runs **keyless** locally (in-memory Pint Drops + structured Landlord fallback). Production is different: without Supabase configured, Pint Drop writes intentionally return **503** and admin moderation is unavailable — the store never lies about durability.

## Function placement and HTML caching

`vercel.json` owns the default London placement for Vercel Functions. Measured
launch latency, the bounded route-trace reduction, and remaining production
verification live in the
[cold-start bundle evidence](evidence/cold-start-bundle.md). Production
cold-start effect remains unverified until deployment.

HTML cacheability remains a security decision, not a deployment toggle. The
[CSP and caching decision brief](evidence/csp-vs-caching.md) owns the options
and pending captain decision.

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
| `OPENAI_API_KEY` | **Server-only** key for Social post, comment, and quote moderation. See the [cron failure posture](CRON_PLANE_RUNBOOK.md#failure-posture-never-fake-success) for missing-key responses and production diagnostics. Keyless local app behavior remains available. |
| `ADMIN_TOKEN` | Moderator auth for `/admin` and moderation APIs. Prefer the httpOnly session cookie from `POST /api/admin/session` (the admin console never needs to keep sending the raw token). The `x-admin-token` header remains accepted for scripts/back-compat. If unset, moderation is open **only** in dev/test (`NODE_ENV`) — always set it anywhere reachable, including preview deployments. **Required in production:** `assertServerEnv()` refuses to start if this is unset (FATAL at route import). |
| `SOCIAL_MODERATOR_STAFF_ROLE_ID` | Server-only UUID of the active `private_social_staff_roles` moderator bound to the existing admin token/session. Social moderation SQL validates that the role is active and not revoked before reads or writes. |
| `RATE_LIMIT_SALT` | At least 32 random bytes for `sha256(salt:ip)` IP hashing (raw IPs never reach the DB or logs) and the fallback trusted Plan-signing key. Defaults are allowed only for non-trusted local helpers. **Required in production:** `assertServerEnv()` refuses to start if this is unset, short, or still the dev default. |

Moderator cookies contain a versioned issuance time signed with `ADMIN_TOKEN`.
The server refuses a cookie at 24 hours, even if a caller sends it after browser expiry.
It also refuses future timestamps and changed signatures.
Changing `ADMIN_TOKEN` invalidates existing sessions.
The signed format replaces the old static token digest, so existing moderators must sign in again after this update.
The `x-admin-token` header remains available for scripts.

### Optional — The Landlord (heritage Q&A)

| Var | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Enables narrated LLM answers via OpenRouter. Without it, `/api/heritage` returns the grounded, structured-only fallback (reads the facts back, never invents). |
| `OPENROUTER_MODEL` | Model id. Defaults to `anthropic/claude-sonnet-4-5`. Also used by the optional OpenRouter tool loop on `POST /api/ask` (map Ask). Pal typed chat and voice do not use OpenRouter. |

### Pub Pal voice and hosted typed chat (ElevenLabs)

Map Ask on `/api/ask` and `/pal/chat` typed asks stay keyless without ElevenLabs (`/api/pub-pal/chat` falls back to the same grounded `runAsk` tools). Voice and the hosted-LLM typed path need the agent values below. Full runbook: `docs/PUB_PAL_SETUP.md`.

| Var | Purpose |
|---|---|
| `ELEVENLABS_API_KEY` | **Server-only** ElevenLabs account key. Never exposed to the browser; `/api/pub-pal/voice-token` mints short-lived session URLs. |
| `ELEVENLABS_PUB_PAL_AGENT_ID` | Agent id from `npm run pubpal:agent -- --base-url https://your-deployment`. |
| `ELEVENLABS_LLM_SHARED_SECRET` | **Server-only** secret for webhook tools at `/api/pub-pal/tools/{name}`. |
| `ELEVENLABS_VOICE_*` | Per-species and onboarding voice ids (`lib/palElevenLabsVoice.ts`). See `docs/PUB_PAL_SETUP.md`. |

**Deploy checklist for a change to Pub Pal.** The ElevenLabs agent is not part of the deploy, so check it beside the deploy:

1. Run `npm run pubpal:agent -- --check --base-url https://pubmaxxing.com` with the ElevenLabs key set. It only reads the live agent and tools, prints every difference from the config in this repo, and exits 1 on any drift.
2. If it reports drift, the captain re-runs `npm run pubpal:agent -- --base-url https://pubmaxxing.com`. Typed chat and voice start work with the agent either before or after the deploy, so the order does not matter.
3. Run the check again and expect exit 0. After a re-run that turns authentication on, an unsigned WebSocket to the agent is refused.

### Optional — other integrations

| Var | Purpose |
|---|---|
| `PLAN_IDEMPOTENCY_SECRET` | Optional dedicated HMAC secret of at least 32 random bytes for retry-safe Plan writes, grounding proofs, referral signup proofs, and verified loop analytics. When omitted, the required `RATE_LIMIT_SALT` is used. A configured short value fails startup/signing rather than silently falling back. |
| `EXA_API_KEY` | Powers the scheduled signals-ingestion job (docs/plans/sol.md TL-6). If unset, that job is skipped; the interactive app path does not depend on it. |
| `SEARCH_PROVIDER` | **Server-only** `exa` (default) or `tavily` selector for `/api/cron/enrich-city-pubs`. `exa` may fall back to a configured Tavily key. `tavily` uses only Tavily, so one environment change can switch providers without a code change. |
| `AI_GATEWAY_API_KEY` | Optional **server-only** explicit Vercel AI Gateway credential for Exa search in `/api/cron/enrich-city-pubs`. Vercel request-context OIDC is also accepted automatically. No separate Exa key is used by this path. |
| `SEARCH_GATEWAY_MAX_CALLS` | Hard per-run Gateway call cap for city enrichment. See `docs/CRON_PLANE_RUNBOOK.md` for the billing and spend-log contract. |
| `TAVILY_API_KEY` | **Server-only** key for `npm run enrich:city`, the explicit Tavily cron selection, and the Exa cron fallback. See `docs/CRON_PLANE_RUNBOOK.md` for missing-provider behaviour. |
| `ARIZE_API_KEY` / `ARIZE_SPACE_KEY` | Optional **server-only** Arize AX tracing of server model calls. Tracing is off unless both are set. See `docs/observability/arize.md` for setup and what is sent. |
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
| `VERCEL_OIDC_TOKEN` | Supplied by the Vercel CLI / build (`vercel env pull`, `vercel dev`) for local OIDC federation. Production functions receive OIDC through request context. AI SDK Gateway and server-side search-provider selection resolve both paths. Do not set it manually. |

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
| `0020_ratings.sql` | Durable drink ratings and venue-summary compatibility rows with raw row access denied; public reads go through aggregate API responses. The retired venue panel and top-rated-pub list are not part of the deployed surface. |

Run each via the Supabase SQL editor, or with the Supabase CLI (`supabase db push` / `supabase migration up`) pointed at the project.

Production migration history already contains
`20260806035204_0070_v1_release_security.sql`. Migrations `0071` and `0072` have
earlier timestamps, so Captain must apply them with
`supabase db push --include-all`; a normal push can skip them as out of order.

Current production migration state and source-ledger reconciliation are owned by
the [soft-launch runbook](SOFT_LAUNCH_RUNBOOK.md#13-migrations). Check the live
ledger there before applying any migration, including the `0127`-`0132`
reconciliation entries and the `0133`-`0136` Plan account-claim follow-up
entries, all with their matching rollback files. Captain applies migrations;
agents do not apply them.

Supabase installs the pgcrypto extension in the `extensions` schema, not
`public`. Local test Postgres installs it in `public`, which hides the
difference until a live apply. Write any `digest()`/pgcrypto call as
`extensions.digest(...)`, or include `extensions` in the function's
`search_path`, so the same migration runs on both.

Quick post-migration smoke:

- With a signed-in account-linked `@alice` and a live `@bob` profile, `POST /api/messages` with `{ "action": "send", "handle": "alice", "other": "bob", "body": "hello" }` returns `201`.
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

### 3. Browser sign-in (email magic link + Google + Apple + Microsoft)

The web and Android paths call Supabase Auth with `signInWithOtp` for passwordless email and `signInWithOAuth` for Google, Apple, or Microsoft (Supabase provider id `azure`). All four methods request the canonical site's `/auth/callback`, then return to the path where sign-in started. The canonical browser client uses the implicit flow, with tokens in the URL fragment. `AuthProvider` captures and scrubs them before asynchronous verification or session installation. The separate iPhone paths follow the [provider-return contract](rules/ios-native-auth-return.md) and [email-return contract](rules/ios-native-email-return.md).

Post-auth navigation uses `safeAuthNext` in [`lib/authRedirect.ts`](../lib/authRedirect.ts) to reject absolute URLs, protocol-relative URLs and paths with backslashes. The guard also checks the normalised path and resolves it again against the app origin. A path such as `/..//evil.example`, which becomes `//evil.example`, returns `/` instead. The callback checks the final redirect destination against the request origin before sending it. Never add a client-controlled redirect that bypasses the shared guard.

App fragments are never copied into Supabase's `redirectTo`: the browser holds them in a TTL-limited record keyed by a cryptographically random attempt ID. It restores them only for a claimed local attempt and matching return path, because Plan invite fragments contain one-use capabilities. The Web Locks API coordinates one live attempt across tabs, and the initiating tab records its attempt in `sessionStorage` to allow an explicit retry. Starting an attempt requires persistent browser storage and Web Locks; an incoming token callback without a local claim follows the confirmation path below. Secrets stay in the Supabase dashboard. The Next.js app only needs the public URL and publishable key above.

An unowned callback, including an email link opened in another browser, shows **Sign in as [verified email]?** before installing a session. The prompt names an email only when the provider reports it confirmed, because the sender of a crafted token link can choose an unverified one; otherwise it reads **Sign in to this account?**. Choose **Continue** to install that account's verified, rotated tokens, or **Cancel** to keep the previous stored session. An unowned callback is offered only when the provider's `amr` claim names an emailed link: `magiclink` or `email/signup`, or `otp` when the account has a confirmed email and no confirmed phone. GoTrue records `otp` for SMS codes too, and this app has no phone sign-in, so an `otp` session on an account with a confirmed phone is refused. OAuth and password sign-ins always return to the browser that started them, so an unowned one is refused as a handed-over session. A callback claimed by this browser's local attempt completes automatically.

[`lib/authCallbackClient.ts`](../lib/authCallbackClient.ts) owns callback verification. It reads identity directly from the provider without letting lookup errors mutate the live browser session. It verifies the refreshed identity and rejects mismatched access and refresh identities. The expired-access exception requires the provider's specific expiry response and a parsed subject matching the freshly verified identity; browser time does not decide expiry. Other verification failures reject the callback. `AuthProvider` finishes session restoration and publishes its result before offering confirmation, and reuses pending work across StrictMode effect replay. Regression coverage lives in `__tests__/authCallbackClient.test.ts`, `__tests__/authCallbackConfirmation.test.tsx`, and `e2e/auth-callback-confirmation.spec.ts`.

Google, Apple, and Microsoft buttons follow the live public provider flags from
Supabase Auth's `/auth/v1/settings` endpoint (`google`, `apple`, and `azure`
respectively). The server reads them and the browser asks the same-origin
`GET /api/auth/providers`, which the edge caches for five minutes, so a
dashboard toggle can take that long to show or hide a button. Disabled or
unreadable providers stay hidden, and each provider is checked again with an
uncached `?fresh=1` read before OAuth starts. Email magic-link sign-in remains the
complete primary path when no social provider is enabled.

As of 29 July 2026, neither Google nor Apple is enabled in production. Their
buttons therefore stay hidden there. This is provider configuration state, not
an application deployment blocker; email magic link remains complete.

#### Captain-owned Supabase URL config

Dashboard → Authentication → URL Configuration:

| Setting | Value |
|---|---|
| Site URL | `https://pubmaxxing.com` (canonical production apex) |
| Redirect URLs | `https://pubmaxxing.com/auth/callback`, `http://localhost:3000/auth/callback` |

These are captain-owned dashboard settings and required target values, not
evidence that the current Supabase project is configured completely. Repository
verification and local browser screenshots provide current evidence for the
shipped callback contract and local same-origin flow, but cannot inspect or
prove those remote values. Successful-session production verification remains
blocked until the captain applies them, requests a production magic link, and
confirms both the canonical callback address and signed-in session.

Set `NEXT_PUBLIC_SITE_URL=https://pubmaxxing.com` in every deployed Vercel
environment, including previews. This is a captain-owned setting and its
presence in repository documentation is not evidence that every Vercel
environment is configured completely. Deployed auth always requests the apex
callback, so do not allowlist `*.vercel.app`, preview hosts, or `www`. A rejected
`redirectTo` makes Supabase fall back to Site URL. If Site URL points at a
deployment host, an email link lands on the wrong origin without the initiating
origin's attempt record or stored return fragment.

Missing or invalid deployed configuration must not block a Vercel build.
Runtime server paths still use the apex and emit a fatal diagnostic when
`NEXT_PUBLIC_SITE_URL` is missing, malformed, insecure, or noncanonical. A
sign-in opened on a deployment host first navigates to the same safe path on
the apex; no local attempt state is created until the user starts sign-in there.

These controls solve different problems:

- Vercel Deployment Protection is access control. The Vercel Authentication
  scope **Production Deployment URLs and All Preview Deployments** keeps the
  custom production domain public while protecting deployment URLs and
  previews. Configure it in Vercel Project Settings under Deployment
  Protection. Signed-in team members can still open protected URLs. Other
  reviewers need a temporary share link, and automated checks need an
  automation bypass secret.
- A permanent host redirect is canonicalisation, not access control. Redirecting
  Vercel's generated production aliases to the apex stops them serving an
  independent copy. `proxy.ts` evaluates the incoming host on every request, so
  canonicalisation does not depend on which environment built the artifact.
  Every production `*.vercel.app` host redirects a PAGE DOCUMENT by default.
  Preview deployments remain reviewable when `VERCEL_ENV=preview` and the
  incoming host exactly matches Vercel's request-time `x-vercel-deployment-url`
  header or the artifact's `VERCEL_BRANCH_URL`. Canonical, localhost, loopback,
  and LAN hosts do not need an exception.
- The `/api` tree is exempt from that host redirect on every host. A caller
  wants an answer, not a new address, and Vercel's cron dispatcher issues its
  scheduled GET against the deployment's own generated host without following a
  redirect. Between #664 and the exemption, every job in `vercel.json` answered
  308 and no handler ran, including `freshness-audit`, the watchdog that would
  have reported it. The credential is what protects those routes:
  `assertCronRequest` (`lib/cronAuth.ts`) requires
  `Authorization: Bearer ${CRON_SECRET}` and denies in production when the
  secret is unset, so the host was never the gate.
  `__tests__/vercelProductionHostRedirect.test.ts` pins both halves, and reads
  the scheduled paths from `vercel.json` so a new cron cannot fall outside it.

Vercel documents `VERCEL_URL` as incompatible with Standard Deployment
Protection, which this project requires. The unique deployment-host comparison
therefore uses `x-vercel-deployment-url`, the request header Vercel supplies for
the specific deployment instance. `VERCEL_BRANCH_URL` remains the identity for
the generated branch alias.

Vercel's promotion API points production traffic at an existing deployment and
[does not rebuild it](https://vercel.com/docs/rest-api/projects/point-production-traffic-to-a-given-deployment).
Empirical promotion checks show that a Preview-built artifact retains
`VERCEL_ENV=preview` after promotion, so that value alone does not identify
production traffic. Vercel's request header still identifies the specific
deployment while the generated branch value identifies its branch alias. The
request-time rule therefore requires an exact host match with that evidence
before applying the Preview exemption. A production alias hitting the promoted
artifact still redirects even when the Preview environment remains set.

Recommendation: retain that Vercel Authentication scope, keep `www` redirecting
to the apex, keep all identity-provider callbacks on the apex, and keep the
request-time wildcard redirect for generated Vercel hosts. That combination
blocks anonymous access and removes production Vercel aliases for signed-in
team members while keeping Preview deployments reviewable.

#### Passwordless email (magic link)

1. Supabase → Authentication → Providers → **Email**: enable Email and confirm-password/email links. The app intentionally calls `shouldCreateUser: true`, so a valid first-time address creates an account through the same flow.
2. Supabase → Project Settings → Auth → SMTP: configure a production sender, verified domain, and reply-to address. Supabase's development sender is not a production delivery guarantee. Review the dashboard's email rate limits against expected launch traffic.
3. Authentication → Email Templates → **Magic Link**: keep the action URL based on `{{ .ConfirmationURL }}`. Preserve the [browser sign-in callback contract](#3-browser-sign-in-email-magic-link--google--apple--microsoft); a custom `token_hash` template needs a separate server-cookie verification route and must not be switched on silently.
4. Make the template name PUBMAXX, state that the link signs the recipient in, include an expiry/help line, and do not include account-existence language. Test delivery, expiry, duplicate clicks, a new address, an existing address, and spam placement before launch.

The UI deliberately gives the same success message for every address and replaces provider failures with normalized retry/rate-limit copy. This prevents the client from becoming an account-enumeration oracle. Supabase remains the enforcement point for actual email sending and rate limits.

**Wrapped shell / deep links:** the [iPhone email-return contract](rules/ios-native-email-return.md) owns return-to-app authentication and its device acceptance requirements. Android and browser email keep the [browser sign-in callback contract](#3-browser-sign-in-email-magic-link--google--apple--microsoft). Browser completion does not establish a session inside the shell. Supabase still redirects to the canonical HTTPS callback. Do not change the dashboard redirect to a custom scheme.

Vercel must attach both `pubmaxxing.com` and `www.pubmaxxing.com` to the same production project, with `www.pubmaxxing.com` permanently redirecting to the canonical apex. After an explicitly authorised deployment, verify that the apex returns the release, the `www` redirect preserves the path and query string, and both TLS certificates are valid:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://pubmaxxing.com/map
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://www.pubmaxxing.com/map?sel=venue-xjf3n0'
```

The apex prints `200`. The `www` host prints `308 https://pubmaxxing.com/map?sel=venue-xjf3n0`. Neither command follows the redirect, so the second reads the first response's `Location`, not the page it leads to. Both requests complete a TLS handshake, which checks each certificate.

#### Google

1. Google Cloud Console → create an OAuth client (Web).
2. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback` (and optionally your site callback if you also list it there).
3. Supabase → Authentication → Providers → **Google** → paste Client ID + Client Secret → Enable.

#### Apple

Supabase's provider id is **Apple** and the app calls `provider: "apple"`.
Apple web sign-in requires an active paid Apple Developer Program membership.
Do not hold launch on this provider when that account is unavailable; email
magic link remains complete.

1. Apple Developer → Certificates, Identifiers & Profiles → create or select an App ID with Sign in with Apple enabled.
2. Create a Services ID for the web client and associate it with the App ID.
3. Add `https://<project-ref>.supabase.co/auth/v1/callback` as the return URL. Apple returns to Supabase first, not directly to the Next.js callback.
4. Create a Sign in with Apple key and record the Team ID, Services ID, Key ID, and private key.
5. Supabase → Authentication → Providers → **Apple** → enter those values → Enable.
6. Exercise both first consent and repeat sign-in. Apple supplies a person's name only on first consent, so PUBMAXX onboarding never depends on provider name metadata.

#### Microsoft (Azure)

Supabase's provider id is **Azure** and the app calls `provider: "azure"` with scopes `email openid profile`. Availability follows `external.azure` in `/auth/v1/settings`.

1. Microsoft Entra admin center → App registrations → New registration. Set supported account types to **Accounts in any organizational directory and personal Microsoft accounts**, which matches Supabase's default `common` tenant URL. A narrower choice refuses personal Microsoft accounts at consent.
2. Add a Web redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase receives the OAuth response first).
3. App registration → Token configuration → Add optional claim → ID token → `xms_edov`. Without it Supabase treats the Microsoft email as unverified, so a Microsoft sign-in does not link to an existing email or Google account with the same address.
4. Supabase → Authentication → Providers → **Azure** → paste Application (client) ID and client secret → Enable.
5. Add the app callback URL to Supabase → Authentication → URL configuration → Redirect URLs: `https://pubmaxxing.com/auth/callback` (and local dev URLs as needed).

Button visibility and email fallback follow the browser sign-in contract above.
Changing provider state needs no app code or deployment.

## Build-time data artifacts

`npm run build` first regenerates the browser data packs and the server-only venue
detail pack:

| Output | Role |
|---|---|
| `public/data/venues_slim.manifest.json` | London map shard manifest for viewport loading. |
| `public/data/venues_slim.core.json` and `public/data/venues_slim.cell.*.json` | London map rows loaded for the opening viewport and later camera bounds. |
| `public/data/venues_slim.json` | Complete compatibility index for server and whole-index readers. |
| `public/data/cities/*/venues_slim*.json` | City slim indexes, compatibility cores, and manifests. |
| `public/data/uk_base/` | Deferred, viewport-streamed unverified UK pub layer. See its README for the delivery contract. |
| `data/generated/venue_detail_index.json` | Byte-offset manifest for lazy detail reads. |
| `data/generated/venue_details.jsonl` | Per-venue detail payloads: pub price rows or curated venue facts (not committed). |

Do not commit the `data/generated/` detail binaries. Vercel/CI regenerates all
build-time packs in `npm run build`; the UK base pack remains committed so first
paint never needs server-side generation. If venue detail artifacts are absent
locally, `lib/venueDetailIndex.ts` falls back to the raw pint dataset plus
`data/famous_venues/` outside production so `/api/venue/[id]` still works in
dev/test.

## Continuous integration and deployment checks

`vercel.json` sets the build command:

```json
{ "buildCommand": "npm run validate-data && npm run build" }
```

**Every Vercel deploy runs the data validation gate and the Next build only.** It does not run lint, typecheck, tests, or coverage. PR [#748](https://github.com/Singularityszn/pubmax/pull/748) narrowed the build command on 2026-08-06 to cut Vercel build-minute cost. Lint, typecheck, and tests moved to GitHub Actions (`.github/workflows/ci.yml`).

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) owns CI triggers and
commands. The [CI runbook](CI_RUNBOOK.md) owns runner prerequisites, configuration,
and recovery. Check the current run before treating CI as release evidence.

Run `npm run ci` locally before every push. A Vercel build alone does not prove
the full gate passed. If Actions fails before job allocation, restore runner or
account allocation before calling the release gate green.

### Manual deploy and promote

There is no manual production path. Production ships through the [one release command](#one-release-command), `npm run release:prod`, and nothing else.

Never promote a Preview build. `npm run deploy:preview` followed by `vercel promote <deployment-url>` puts a Preview-built artifact in front of production, and [promotion does not rebuild it](https://vercel.com/docs/rest-api/projects/point-production-traffic-to-a-given-deployment): it keeps `VERCEL_ENV=preview` and every Preview environment value. The release command stages with `scripts/deploy-vercel.mjs --prod --skip-domain` instead, so the artifact it promotes was built with Production values.

`npm run deploy:preview` is for review deployments. It is `vercel deploy` plus the commit of the tree it is
uploading. The [build identity reference](#which-commit-is-this-deploy-serving) owns the response fields and authentication requirements.
The command forwards every argument.

Deploying from a Mac is fine because the build runs in Vercel's cloud. Never pass `--prebuilt` from a Mac: the locally built sharp binary is darwin-arm64 and crashes the linux runtime. `npm run deploy:preview:prod-env` refuses that flag for you.

`docs/SOFT_LAUNCH_RUNBOOK.md` section 1.2 owns the launch-day checks after a release.

### One release command

```sh
npm run release:prod
```

This is the way to ship to production. It runs these steps in order and stops at the first failure:

1. It refuses a dirty tree, and a `HEAD` that is not the tip of `origin/main`. The smoke run is dispatched on `main`, so the released commit has to be that tip.
2. It runs `npm run check:migration-ledger` and refuses when production lacks a migration the repo ships.
3. It stages a Production-target build with `scripts/deploy-vercel.mjs --prod --skip-domain`, so the build stamps the commit and reads Production environment values, and no domain moves yet.
4. It reads `/api/version` on the new deployment, then runs `vercel promote`.
5. It waits until `https://pubmaxxing.com/api/version` names the new deployment.
6. It dispatches `.github/workflows/prod-smoke.yml` on `main` with the released deployment ID. It selects the matching run and waits with `gh run watch --exit-status`.

The command selects the newest run that meets all these conditions:

- Its `headSha` matches the released commit.
- Its `displayTitle` exactly matches `Production smoke <deployment_id>` for the released deployment.
- Its `createdAt` is no earlier than five seconds before dispatch.

If no matching run appears within the lookup timeout, the command reports production as live and unverified. The [smoke runbook](../e2e/prod-smoke/README.md#after-every-deploy) owns dispatch inputs, deployment checks, and replacement failures.

A failed smoke run exits non-zero. If the live deployment changed or cannot be read, the command reports the released deployment as unverified. If the released deployment remains live, inspect the run before you fix forward or roll back with `vercel rollback`.

`npm run check:migration-ledger` is read-only. It reads `supabase_migrations.schema_migrations` through the Supabase Management API read-only query endpoint and compares by migration NAME, never by version, because the live versions differ from the file timestamps. A repo file counts as applied when the ledger holds its full name (`0161_plan_selected_drink_evidence`) or its bare slug. Names only the ledger holds are listed and are not a failure. It needs `SUPABASE_ACCESS_TOKEN`, a personal access token from the captain's Supabase account, in the environment. `SUPABASE_PROJECT_REF` overrides the production project.

The command needs `gh` signed in with permission to run workflows in `Singularityszn/pubmax`, and a Vercel CLI session (`PUBMAX_VERCEL_BIN` names an installed one; otherwise npx runs the exact version pinned in `scripts/lib/vercelCli.mjs`, never `latest`). The ordered steps are `scripts/lib/releaseProduction.mjs`. Pin: `__tests__/releaseProduction.test.ts`.

### Uptime monitor

Point a free external monitor at `https://pubmaxxing.com/api/health`, every 1 to 5 minutes, and alert on any status that is not 200. UptimeRobot, Better Stack and Cronitor all have a free tier for this. A 503 means the deployment is up and its database is not answering. `/api/version` stays a memory-only check and cannot tell you that, so monitor both if the monitor allows two checks.

The body is `{ "ok": true, "deploymentId": "dpl_...", "database": "ok" }`. The route reads one row of `rate_limits` and holds the answer for 15 seconds per instance, so a one-minute monitor costs the database little. Pin: `__tests__/healthRoute.test.ts`.

### Alert webhook

Set `PUBMAX_ALERT_WEBHOOK_URL` to an https Discord or Slack incoming-webhook URL, in the Vercel Production environment and as a GitHub repository secret of the same name. Treat it as a credential. With it unset, nothing is sent and nothing is logged about the missing value.

The [alert policy](rules/lib-observability.md#an-alert-leaves-the-process-through-one-webhook-and-unset-is-silent) owns event selection, delivery limits, privacy rules, delivery-failure diagnostics and GitHub workflow coverage.

### A preview built with production values, in one command

```sh
npm run deploy:preview:prod-env
```

It reads the production environment, builds in Vercel's cloud, and returns a
PREVIEW URL. It never promotes, and it writes nothing to Vercel: `vercel pull` is
a read, and every value it carries rides on that one deploy.

What the command does, in order:

1. `vercel pull --yes --environment=production` into `.vercel/.env.production.local`.
2. Sorts what came back into three groups (`scripts/lib/previewProdEnv.mjs`).
3. Runs `npm run deploy:preview` with each carried value as `--build-env` and
   `--env`, so a `NEXT_PUBLIC_*` value reaches the client bundle and the running
   function alike, and the commit stamp rides along as before.
4. Prints the names it carried and the names it could not.
   Verify the running commit with the [build identity procedure](#which-commit-is-this-deploy-serving).

**What it establishes.** A successful deploy produces a preview built with the
production values Vercel returns, on its Linux runtime. Establish its running
commit separately with the build identity procedure above.
Secret values returned as `[SENSITIVE]` are dropped, so do not assume the preview received `CRON_SECRET`.

**What it does not prove.** Two gaps, and the command names both on the way out.

- **Secret-typed values cannot be pulled.** Vercel writes `[SENSITIVE]` in their
  place. Measured 5 September 2026 against the live project: 30 of 59 values,
  six of them `NEXT_PUBLIC_*`. Those are DROPPED rather than carried, because a
  forwarded placeholder is inlined into the client bundle: a verification
  preview once shipped `NEXT_PUBLIC_SUPABASE_URL="[SENSITIVE]"`, so no browser
  could sign in, and `NEXT_PUBLIC_DEMO_CONTENT="[SENSITIVE]"` read as "not off"
  and put demo rows on the landing page. The preview falls back to the project's
  own Preview environment for each dropped name.
- **A preview RUNS with the Preview environment.** That is Vercel's rule, not
  ours. Cron routes (no `CRON_SECRET`), live Ticketmaster and web push are
  therefore unexercised on any preview.

Platform-owned names (`VERCEL_*`, `TURBO_*`, `NX_*`) are never carried either.
`VERCEL_ENV` is the reason: `proxy.ts` and `app/robots.ts` both key indexability
on it, so a preview that called itself production would be indexable.

**Never `--prod`, never `--target`, never `--prebuilt`.** The command refuses
all three. `--prod` promotes, and `--target production` (or `--target=…`, or
`-t`) is the same production deploy by another name, one that would skip every
check `npm run release:prod` runs; `--prebuilt` uploads a macOS build, whose
sharp binaries are darwin-only and answer 500 on every route that imports them.

Four failures in the earlier three-command recipe are fixed at their sources,
so this command works from a clean worktree:

| Failure | Fix |
|---|---|
| `A deploy revision is required for production builds` from a pulled environment (`VERCEL_GIT_COMMIT_SHA=""`, no deployment id) | `lib/dataRevision.mjs`: the working tree names the revision; only a build with no environment AND no git refuses. |
| `--prebuilt` refusing a `--prod` output for a preview target | The build runs in the cloud, so there is one target and no `builds.json` to edit. |
| Upload ENOENT on `docs/**` from a whole-project trace | `lib/venueIndexOsm.ts`: the dynamic path is marked, and the two functions that traced 10,044 and 10,034 files now trace 295 and 285. |
| `Could not load the "sharp" module using the linux-arm64 runtime` | A cloud build installs the linux binaries; `--prebuilt` is refused. |

Pin: `__tests__/previewProdEnvDeploy.test.ts`.

### A preview a verifier can sign in to

A preview with no Supabase values can sign nobody in, so every journey past the
first screen is unverifiable on one. A verifier lost an hour to that on
5 September 2026 (L06, core-loop battle test): a fresh worktree's `npm run
deploy:preview` landed in Vercel project **`pubmaxx`**, which carries no
environment variables at all and sits behind Vercel Authentication, so
`/api/version` needed a share link and no account could be created. The script
now prints the project it will deploy to before it uploads anything; read that
line.

Four things a signable preview needs.

1. **The right project.** `.vercel/project.json` is gitignored and local, so a
   worktree can carry a link nobody chose. Pick it explicitly:

   ```sh
   vercel link --project <name>
   ```

   Verification previews have used **`chengdu`**, which is not behind Vercel
   Authentication. `pubmaxx` is not that project.

2. **An isolated database. Never production.** Point the preview at a separate
   Supabase project with its own migrations and its own `pint-drops` bucket.
   A verification run creates plans, joins crews and writes prices; production
   data is never the place for it.

3. **The variables, inline on the deploy.** Passing them on the command keeps
   the stored project environment untouched, so one verifier's run cannot change
   what the next deploy of that project does. `-b` is the build environment and
   `-e` the runtime one; the `NEXT_PUBLIC_*` values are build-time, so they need
   both.

   ```sh
   npm run deploy:preview -- \
     -e SUPABASE_URL="$SUPABASE_URL" \
     -e SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
     -e ADMIN_TOKEN="$ADMIN_TOKEN" \
     -e RATE_LIMIT_SALT="$RATE_LIMIT_SALT" \
     -b NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
     -b NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
     -e NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
     -e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
   ```

   Read the values out of the shell rather than typing them, so no key lands in
   shell history or in a log.

4. **Accounts that already exist.** Email magic links do not arrive at a
   verifier, so seed handles in the isolated database and set their passwords
   through the admin API, then sign in with handle and password. The battle test
   used `alicepent`, `bobpent` and `carolpent`.

**No rollout variable is needed for a Plan to be readable by its own host.**
`PUBMAX_FRIEND_MEMBER_REHYDRATION_V2` is retired: it gated the member
projection, so a preview without it answered the anonymous preview to everyone
and a host read "You've been invited" on their own plan (D01, same report). A
capability is now the whole question. Do not set that variable, and do not add
it back to a deployment.

### Which commit is this deploy serving

`GET /api/version` publicly returns `ok`, `deploymentId` and `gitCommitSha`.
The commit names the code used for the build. It is `null` when the build cannot name its commit.
In production, `gitCommitShaSource` and `builtAt` require a valid `Authorization: Bearer` header with the target's existing `CRON_SECRET`.
Missing or invalid credentials still receive the public fields.
If `CRON_SECRET` is unset, development and test requests also receive the operational fields without authentication.
Never put that credential in an argument, log or file.

Run this from the clean checkout that produced the deployment.
Set `DEPLOYMENT_URL` to its HTTPS URL.
The request fails if the running commit differs from HEAD or is absent.

```sh
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
const target = process.env.DEPLOYMENT_URL;
if (!target) throw new Error('Deployment URL required');
const expected = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const response = await fetch(new URL('/api/version', target));
if (!response.ok) throw new Error('Build marker request failed');
const marker = await response.json();
if (!marker.gitCommitSha || marker.gitCommitSha !== expected) {
  throw new Error('Running commit unverified');
}
console.log(JSON.stringify(marker));
NODE
```

Older deployments can hide the commit behind cron authentication.
Keep their public commit verification pending until a new build includes this route change.
Both response forms use `no-store` headers for browsers and CDNs.
The build inlines the metadata. The route runs no git.
The authenticated response also includes the source and build time.

```json
{
  "deploymentId": "dpl_...",
  "gitCommitSha": "182aa88212fc58cd2d146a5c3a4a91efe4c6a1fb",
  "gitCommitShaSource": "working-tree",
  "builtAt": "2026-09-05T07:30:00.000Z"
}
```

| Field | What it says |
|---|---|
| `deploymentId` | WHICH deploy answered. It does not name what is in it. |
| `gitCommitSha` | The commit the running code was built from, or `null` when the build could name no commit. |
| `gitCommitShaSource` | `vercel-git` when Vercel's Git integration stamped the build, `working-tree` when the build read the commit of the tree it built, `null` with no sha. |
| `builtAt` | When the build ran, as an ISO instant. |

The two sources are separate on purpose. `vercel-git` is a commit Vercel checked
out, so it names something that was pushed. `working-tree` is the commit of the
tree the build ran over: on a `vercel deploy` from a CLI that tree is the one on
the machine that ran the command, so it can carry uncommitted work, and matching
it against local `git rev-parse HEAD` is what proves the preview serves the code
you meant to send.

A CLI deploy has to carry its own commit, and `npm run deploy:preview` is how it
does. Measured 2026-09-05 against preview `dpl_CgDWoXWduiQJyFBwJPEYSHTsdcB8`: a
bare `vercel deploy` uploads no `.git` directory and Vercel stamps no
`VERCEL_GIT_COMMIT_SHA` on either the build or the runtime of such a deploy, so
the builder has nothing to ask and the marker answered `null` on exactly the
previews that needed identifying. The script reads `HEAD` on the machine running
the command and passes it as a build variable; every argument is forwarded, so
the target stays the operator's call, and `PUBMAX_VERCEL_BIN` names a CLI binary
for anyone who has their own. A deploy through Vercel's Git integration needs
none of this and answers `vercel-git`.

**A dirty tree stamps nothing.** A CLI deploy uploads the working tree, so over a
dirty tree the commit would name code that was not sent; the script warns, the
deploy proceeds, and `gitCommitSha` is `null`. Commit the tree to get an
identifiable deploy.

Earlier, the route read `VERCEL_GIT_COMMIT_SHA` at request time, which is absent
from the runtime of every CLI deploy. `lib/buildInfo.mjs` now owns the rule,
`next.config.mjs` asks it once during the build, and the values ride in `env` as
`PUBMAX_BUILD_COMMIT_SHA`, `PUBMAX_BUILD_COMMIT_SHA_SOURCE` and
`PUBMAX_BUILD_TIME`. Next replaces a static `process.env.NAME` member expression
with the build-time literal, so the route must read each name directly and never
through a variable key. Pin: `__tests__/deploymentVersionRoute.test.ts`.

### Known GitHub check sources

Read each check against its commit and workflow. A green integration status does
not prove that a deployment ran. Identify the owner and result before changing
product code:

| Check source | What it means | Fix path |
|---|---|---|
| First-party CI | GitHub Actions workflows under `.github/workflows/`. A successful run proves only the jobs that ran at that commit. Push browser checks do not include the full scheduled suite. | Read failed job logs. Keep skipped checks separate from successful checks. |
| `Vercel` | The `chengdu` project's Ignored Build Step can cancel a deployment while GitHub reports success with the description `Canceled by Ignored Build Step`. Production and preview outcomes can differ. | Check each deployment's state, source, target and commit. Require `READY`, then verify the SHA and deployment ID through `/api/version`. A cancelled build proves neither compilation nor deployment. The captain approves any build-policy change. |
| `Supabase Preview` | Supabase GitHub integration. | If it says `Remote migration versions not found in local migrations directory`, sync migration history: pull/export the missing remote migrations or repair the Supabase migration table so remote and `supabase/migrations/` agree. Do not delete local migrations to make this pass. |
| GitHub Actions `startup_failure` | GitHub failed before allocating a job. GitHub shows no jobs and no logs. | Investigate the runner or account. Do not infer a product failure or a Vercel build result. Run `npm run ci` locally for the full local gate. |
| `Greptile Review` | External AI review/check app. | Treat as code-review signal, not a build gate. Address concrete findings in PR comments. |
| Other external app suites | Checks owned by GitHub Apps rather than the first-party workflows. | Identify the integration and its requirement. The captain approves changes to repository or integration settings. |

The publication gates are in [the build methodology](agents/build-methodology.md#completing-a-task).
The daily browser and performance workflows already build and measure the app.
Their schedules do not create a Vercel preview.

The [25 October deployment audit](proof/git-preview-audit-20261025/README.md)
records READY Git production builds alongside cancelled Git previews. That
record does not establish the current policy or guarantee the next build.

For a consecutive-build acceptance target, record each real push and its exact
commit, deployment ID, target and terminal state. A successful GitHub integration
check cannot replace the deployment result. Do not create empty commits to meet
the count. A local build or CLI preview does not prove that the Git build path
works. Keep the target incomplete until the required consecutive Git builds are
READY and their deployed versions match.

#### Daily Git preview proposal

This procedure requires the captain's approval before any Vercel setting changes.

1. Reuse the existing daily browser and performance workflows.
2. Select the exact Main SHA after reviewing those runs, including failed and skipped jobs.
3. Advance one dedicated preview branch at most once per Europe/London calendar day.
4. Allow only that branch through the Ignored Build Step. Keep it separate from the production branch.
5. Require a `READY` Preview deployment with matching SHA and deployment ID in `/api/version`.
6. Test desktop and mobile journeys on that immutable preview URL.

The branch name and setting change remain proposals. No unattended scheduler is
required. The daily limit is an operating rule. This procedure does not grant
production promotion authority.

### Agent workflow for Codex / Opus

Before pushing a branch:

1. Run `npm run ci` locally.
2. Commit only product/docs changes, not local agent state such as `.agents/`, `.claude/`, `.mcp.json`, `.playwright-mcp/`, or skill inventory files.
3. Use the final-head no-mistakes gate for publication, as required by [the build methodology](agents/build-methodology.md#completing-a-task).
4. Check the exact-head CI runs and PR checks with `gh-axi`.
5. Record build, integration, review and deployment results separately. A skipped Vercel build cannot satisfy preview acceptance.

## Identity boundary (demo vs production private actions)

Linked handles are JWT-gated via `gateHandleAction` / `requireLinkedActor`.
Unlinked handles still allow the **demo / anonymous self-asserted** path for
Pint Drops and legacy social writes. Community price and venue-signal writes
instead require a signed-in account and derive their stable profile actor and
public handle on the server. The remaining demo path is intentional product
behaviour, not a privacy model.

Production private actions that must not be forgeable:

- Messages, notifications, profile edits, crawl story edit/delete
- Comments / list-follows when the handle is linked
- Friends-lane visibility (JWT viewer only; `?viewer=` ignored in production)
- Admin moderation (httpOnly session cookie)

See `lib/profileOwnership.ts` header comment for the exact decision table.

## Trust boundary: `x-forwarded-for`

Rate-limit IPs come from the `x-forwarded-for` header (`lib/supabase.ts` → `clientIp`), which is **client-suppliable**. This is safe **only** because Vercel's edge normalises the header (left-most entry = the real client). The IP is a *secondary* limiter signal — write keys lead with the contributor handle — so a spoofed header only widens one actor's own budget.

**A self-hosted deployment must front the app with a trusted proxy** that overwrites `x-forwarded-for`. Do not trust the header behind an untrusted network.
