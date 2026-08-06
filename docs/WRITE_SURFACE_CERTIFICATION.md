# Mutating API surface certification

Wave 0 treats every exported `POST`, `PUT`, `PATCH`, or `DELETE` handler as a
reviewed surface—even when a POST is semantically read-only. The regression test
`__tests__/writeSurfaceCertification.test.ts` scans the complete `app/api` tree.
Adding a mutating route or removing its authority/abuse boundary fails
CI until this certification is deliberately updated.

> **Inventory: 78 mutating routes.** The count grew 60 → 61 (email-capture
> `POST /api/email-subscribers`) → 62 (native `POST /api/push-tokens`) → 63 (the
> Social Loop "we're out" `POST /api/check-ins`) → 64 (the vibe-vote
> `POST /api/plans/[id]/vibe-votes`) → 65 (the area-demand capture
> `POST /api/area-demand`) → 66 (the structured Visit Reports
> `POST /api/visit-reports`) → 67 (author-confirmed alt text
> `PATCH /api/night-moments/[id]/alt-text`) → 69 (the operator rail: `POST
> /api/venue-operators/claim` and `POST /api/operator-proposals`) → 70 (the
> community price submission `POST /api/price-submit`) → 71 (community-price
> moderation `POST /api/admin/community-prices`) → 72 (authored weather
> Recommendations `POST /api/weather-recommendations`) → 74 (private referral
> invite-link creation and same-journey signup claim) → 75 (private Social
> product-account migration) → 77 (verified Social post creation and item
> editing or recoverable removal) → 78 (shared Plan group preferences
> `POST/DELETE /api/plans/[id]/group-prefs`). Account onboarding
> replaces the earlier identity claim POST, so its route does not change the
> count.
> Token-gated GET
> confirm/unsubscribe endpoints and read-only GETs (the Social Loop reads, the
> vibe-vote tally read, the Visit Report venue / contributor-count /
> moderator-lane reads, the operator
> own-claim / moderator queue reads, the per-venue community price and venue
> signal read, the base-pub provisional-mark read, the community-observation
> review queue read, the weather-matched Recommendation read) are
> deliberately excluded from the
> mutating-verb inventory. The number is a merge-conflict coordination point
> across in-flight branches — reconcile it (not silently overwrite) when branches
> meet.

## Boundary classes

| Boundary | Purpose | Representative surfaces |
|---|---|---|
| Durable rate limit | Public/keyless abuse and provider-cost control | Events, discovery proxies, Pint Drops, crawl contributions, Plan creation, email capture |
| Account | Supabase-authenticated ownership | Night Memories/Stories, Pub Pal, profiles, social connections |
| Capability | Narrow possession-based authority plus server validation | Plan actions, completion, invites, constraints, proposals, recap |
| Moderator | Staff-only operational mutation | Import notes and moderation |
| Confirmation | One-use confirmation for a consequential proposal | Night Story publication |

These boundaries compose. For example, Plan creation is rate-limited and fails
closed when durable enforcement is unavailable; later lifecycle writes require a
Plan member capability and use idempotency keys or atomic store operations.

Referral writes are account-bound. `POST /api/referrals/invite-link` derives the
inviter from the verified JWT. `POST /api/referrals/claim-attribution` derives
the new account and its creation time from the same verified identity, then
resolves only an opaque invite code from its body. Neither route accepts an
account ID in its body, and neither returns either side of an invite edge.
Following the public invite route writes nothing. Auth callback code claims are
accepted only for newly created accounts in the same sign-in journey.

Social account migration is account-bound twice. `POST /api/social/access`
derives the legacy Supabase identity with `verifyCallerAuth(request)` and the
protected server seam derives the Clerk identity from middleware-backed session
context. It accepts no account ID, handle, or email from the body. The beta
policy denies the write with `SOCIAL_BETA_DISABLED` while Social remains in
preview, before the Supabase verifier, Clerk check, or migration RPC runs. A
successful call passes only those two independently verified IDs to the
service-only transactional RPC.

Social post writes use one account boundary. Both routes call
`requireVerifiedSocialActor`, which returns the server-held product account ID,
stable profile ID and current handle only after the Clerk session, product
ownership and adult decision pass. No account ID, profile ID, handle,
moderation state, revision or timestamp is accepted from the request body.

## Failure posture

- Anonymous paid spend (`concierge`, narrated `heritage`) and Plan creation pass
  `{ failClosed: true }` to the durable limiter.
- Keyless local development remains usable through the bounded process-local
  limiter when Supabase is not configured.
- Public community contribution paths use durable limits in production and a
  tightened degraded budget on transient limiter failures.
- Email capture (`POST /api/email-subscribers`) enforces durable limits on **two
  axes** — per-IP and a global circuit breaker — and answers 503 on a hard
  durable-store write failure rather than a fake success. It stores the address
  UNCONFIRMED (double opt-in); nothing is mailed until the recipient confirms.
- Account, moderator, and Plan-capability routes reject missing authority before
  persistence. Confirmation-protected publication requires a separate one-use
  token.
- Read-only discovery remains available with caching and abuse controls; it never
  receives a write capability merely because the HTTP verb is POST.

## Route additions since the Wave 0 inventory

### `app/api/social/posts` - verified Social post creation (route 76)

- **Route / method:** `POST app/api/social/posts/route.ts`.
- **Authority:** `requireVerifiedSocialActor` derives the verified Social actor.
  The stable profile ID owns the row. The product account ID never enters the
  response or post table.
- **Abuse control:** Durable create and feed-read limiters use the shared salted
  digest of the stable profile ID, never the raw profile ID, handle or account
  ID. Feed reads partition budgets by lane and listed nearby area.
- **Validation:** Kind, visibility, text, listed area, hashtags and comment
  policy use `validateSocialPostCreate`. Public posts cannot carry an exact
  venue. Raw object keys and every client-supplied ownership, timestamp,
  revision or moderation field are rejected. Photo references remain closed
  until the ownership-checked upload task ships.
- **Moderation:** Durable creation starts in pending moderation and the same
  database write queues an OpenAI moderation job carrying body plus normalised
  hashtags. Pending content cannot reach direct reads or any feed. A protected
  cron drains isolated leased jobs with bounded provider timeouts. Terminal
  holds are counted and only an authenticated operator action can requeue them.
- **Freeze:** The Social freeze guard runs before identity, limiter or storage
  work and pauses creation while reads stay available.
- **Failure:** Invalid input returns 400, unavailable photo upload returns 409,
  unavailable identity or durable storage fails closed, and no fake success is
  returned.

### `app/api/social/posts/[postId]` - verified Social post editing (route 77)

- **Route / method:** `PATCH app/api/social/posts/[postId]/route.ts`.
- **Authority:** `requireVerifiedSocialActor` supplies the verified Social actor,
  and the store matches the row against that stable profile ID. No
  account ID or author field is accepted from the body.
- **Abuse control:** Edit and recoverable removal share a durable limiter keyed
  to the shared salted digest of the stable profile ID.
- **Validation:** Strict edit validation rejects status, revision, timestamp,
  moderation and raw storage fields. A transactional RPC advances private
  `mutation_version` for every successful edit and uses it for compare-and-swap,
  so a stale edit cannot overwrite newer visibility or comment choices. A real
  text, kind, hashtag or future photo change separately advances moderation
  `revision`, returns the row to pending moderation and binds its queued claim
  and decision. Visibility-only and comment-policy edits do not advance the
  moderation revision.
- **Removal:** `{ action: "remove" }` changes status to `removed`. It is a
  recoverable state change, never a delete, and removed content is excluded from
  direct reads and every feed.
- **Freeze:** The Social freeze guard runs before identity, limiter or storage
  work for edits and removals.
- **Failure:** A post outside stable profile ownership returns 403 or 404. A
  hidden, removed or moderation-held post never appears through the item read.

### `app/api/plans/[id]/group-prefs` - shared Plan group preferences (route 78)

- **Route / method:** `POST` and `DELETE` on
  `app/api/plans/[id]/group-prefs/route.ts` (Lane D shared group prefs). The
  route also exports a member-capability `GET` (list + merged hard constraints)
  which is NOT a mutating verb and is not counted.
- **Validation:** `parseGroupPrefWriteInput` (`lib/groupPrefs.ts`) requires a
  closed budget band (`under6` | `standard` | `flexible`) and atmosphere chip
  (`cosy` | `chatty` | `lively` | `music` | `food`); boolean must-haves are
  `zeroProof`, `accessibilityRequired`, and `weatherShelterRequired`. Invalid
  bodies 400 before the store is touched. The store and migration CHECKs
  re-validate.
- **Rate limit (boundary):** durable per-plan + hashed-IP `isLimited` with keys
  `plan-group-prefs:${id}:${hashIp(...)}` (POST) and
  `plan-group-prefs-clear:${id}:${hashIp(...)}` (DELETE). Raw IP never keyed.
- **Auth stance:** member-capability bound via `planMemberCapability`. The store
  admits only the host or a collaboration-authorized guest. Rows are keyed by
  `(plan_id, member_id)`; a token for plan A cannot read or write plan B.
- **Hard constraints:** `overlapGroupPrefs` merges the strictest budget and any
  zero-proof / step-free / covered-shelter ask into `hardConstraints` /
  `mustHaveLabels`. These must-haves are never silently relaxed when a looser
  mate joins.
- **Rollback / kill:** durable rows live in `public.plan_member_group_prefs` +
  `public.plan_member_group_pref_requests` (migration **0076**, RLS on,
  anon/authenticated revoked, service_role only). Forward:
  `supabase/migrations/20260806160000_0076_plan_member_group_prefs.sql`.
  Rollback:
  `supabase/migrations/rollback/20260806160000_0076_plan_member_group_prefs_rollback.sql`.

### `app/api/push-tokens` — native/web push registration (route 61)

- **Route / method:** `POST app/api/push-tokens/route.ts` (Capacitor shell via
  `lib/nativePush.ts`; installed web app via the explicitly-invoked
  `lib/webPush.ts`, never on boot).
- **Validation:** `validatePushToken` (`lib/pushTokenStore.ts`) — trimmed
  non-empty `token` ≤ 2048 chars, `platform` ∈ {`ios`, `android`, `web`}; web
  values must decode to a PushSubscription with bounded browser-generated
  `p256dh`/`auth` keys. Its network destination must match the maintained exact
  Google FCM, Mozilla Autopush, or Apple Web Push HTTPS host/path allowlist on
  the default TLS port; IP literals, localhost, arbitrary/lookalike hosts, and
  custom ports are rejected again at provider send time. Native platforms
  cannot smuggle a web subscription; malformed or
  invalid payloads 400 in the flat public envelope before the limiter or store
  is touched.
- **Rate limit (dual boundary):** durable per-IP `isLimited` with key
  `push-tokens:${hashIp(clientIp(request))}` (raw IP never keyed), budget
  10/hour — a device registers once per boot — PLUS a route-wide global
  backstop (`push-tokens:global`, 300/hour across all callers). The per-IP key
  derives from forwarding headers an attacker can rotate per-request where the
  edge doesn't overwrite them; the global ceiling makes key rotation pointless
  and is the table-growth bound. Either exceed → 429
  `{ error, code: "RATE_LIMITED", retryable: true }`. Fail-open on limiter
  outage (no anonymous paid spend behind this route).
- **Auth stance:** deliberately anonymous — native registration happens
  pre-sign-in, and a row carries no identity (only "this device/browser can
  receive public pushes"). Web registration is invoked only after a real user
  action and granted browser permission. Upsert on token keeps re-registration
  idempotent, so table
  growth is bounded by distinct tokens × the IP budget.
- **Rollback / kill:** remove VAPID/APNs provider credentials to select the
  transport-specific loud no-ops, or 503 the registration route. Both client
  seams degrade fail-soft. Durable rows live in `public.push_tokens`
  (migrations 0039 + 0046, RLS on, anon/authenticated revoked);
  `truncate public.push_tokens` is a safe reset — devices re-register on next
  boot.

### `app/api/check-ins` — "we're out" check-in (route 63)

- **Route / method:** `POST app/api/check-ins/route.ts` (Social Loop v1,
  `feat/social-loop-v1`). The route also exports a read-only `GET` (the "Your
  lot" / area read) which is NOT a mutating verb and is not counted.
- **Validation:** `validateCheckInInput` (`lib/checkIn.ts`) — a normalised handle,
  an area that must be a known night-area slug (area-level location only, never a
  coordinate), an optional trimmed venue tag, a cleaned/capped note, and a
  visibility from the `{friends, area}` allowlist (defaults to `friends`).
  Malformed bodies 400 before the store is touched.
- **Rate limit (boundary):** durable per-handle + hashed-IP `isLimited` with key
  `check-in:${handle}:${hashIp(clientIp(request))}` (raw IP never keyed) — 429 on
  exceed. This is the certification boundary (rate_limit class).
- **Auth stance:** the author is the self-asserted handle resolved through
  `resolveMessageHandle` (JWT-linked handle wins when signed in) and gated by
  `gateHandleAction` — the same demo identity boundary as a pint drop or follow.
- **Privacy:** friends-only by default; the single choke `lib/socialFeed.ts`
  decides which check-ins reach which viewer (mutual follows only), so a
  friends-only post can never reach a public query. Rows auto-expire after 12h
  (`expires_at`). Durable rows live in `public.check_ins` (migration 0043, RLS on,
  anon/authenticated revoked); `truncate public.check_ins` is a safe reset.
- **Related privacy change (same migration):** 0043 drops the `follows_public_read`
  policy so the follow graph is service-role-only — follow edges are private to the
  two parties and no follower counts are public.

### `app/api/plans/[id]/vibe-votes` — crew vibe vote (route 64)

- **Route / method:** `POST app/api/plans/[id]/vibe-votes/route.ts` (Vibe Layer
  share loop, `feat/vibe-votes`, docs/VIBE_LAYER_SPEC_2026-07-19.md surface 3).
  The route also exports a read-only `GET` (the aggregate tally: counts + top
  vibe) which is NOT a mutating verb and is not counted.
- **Validation:** `isVibeChipId` (`lib/vibeChips.ts`) — the vote must be one of
  the seven owner-locked chip ids (`bender`, `lit`, `quiet`, `cheeky`, `match`,
  `quiz`, `date`); anything else 400s before the store is touched. The store
  re-validates (defence in depth) and the migration's `check` constraint plus the
  RPC guard reject a bad value at the durable layer too.
- **Rate limit (boundary):** durable per-plan + hashed-IP `isLimited` with key
  `plan-vibe-vote:${id}:${hashIp(clientIp(request))}` (raw IP never keyed) — 429
  `{ retryable: true }` on exceed. This is the certification boundary (rate_limit
  class); the route also carries the Plan member capability (see below).
- **Auth stance:** member-capability bound — `planMemberCapability` resolves the
  private member token (Authorization bearer, path-scoped cookie, or body
  fallback) and the store admits only the host or a collaboration-authorized
  guest, the same authority as a route proposal vote. Upsert on (plan, member)
  keeps a revote idempotent and table growth bounded by crew size.
- **Read stance:** the `GET` tally is tokenless — counts only, no member
  identity — so the public share card (`app/api/plan-card`) and the read endpoint
  can render the crew tally without a capability, consistent with the plan card
  already being publicly renderable from its unguessable id.
- **Rollback / kill:** durable rows live in `public.plan_vibe_votes` +
  `public.plan_vibe_vote_requests` (migration 0044, RLS on, anon/authenticated
  revoked, service_role only); `truncate` both is a safe reset. Until the owner
  applies 0044 the durable write 503s and the tally read drops the share-card
  line (the card still renders) — no crash, no fake success.

### `app/api/area-demand` — unsupported-area demand capture (route 65)

- **Route / method:** `POST app/api/area-demand/route.ts` (Wayfinder 3.2,
  `lane/area-demand-capture`). Backs the demand ask on the honest unsupported-
  area preview (`components/coverage/UnsupportedAreaPreview`), which always shows
  the nearest supported patch as a live alternative BEFORE the ask (value first,
  never a form-wall — taste doctrine).
- **Validation:** `parseAreaDemandInput` (`lib/areaDemand.ts`) — `area` is
  REQUIRED (normalised, whitespace-collapsed, ≤ 80 chars) or 400 `INVALID_AREA`;
  `email` is OPTIONAL and, when a non-empty value is offered, must pass
  `parseEmail` or 400 `INVALID_EMAIL`. A blank/absent email is valid: demand is
  captured WITHOUT contact. `source` is coerced to the
  `{near-empty, area-picker, map-miss}` allowlist; `matchedPatchId` is re-derived
  server-side (an arbitrary body match is never trusted). No coordinates are
  ever accepted or stored. Validation runs BEFORE the limiter so a bad body 400s
  cheaply.
- **Rate limit (boundary):** durable per-IP `isLimited` with key
  `area-demand:ip:${hashIp(clientIp(request))}` (raw IP never keyed), budget
  8/min — a genuine user registers a handful of areas — PLUS a route-wide global
  circuit breaker (`area-demand:global`, 200/min across all callers) that bounds
  table growth against a distributed flood. Either exceed → 429
  `{ error, code: "RATE_LIMITED", retryable: true }`. This is the certification
  boundary (rate_limit class). Public contribution posture: NOT fail-closed — a
  transient limiter outage degrades to a tighter in-memory budget rather than
  refusing genuine signals (no anonymous paid spend behind this route).
- **Auth stance:** deliberately anonymous. Demand is a keyless community signal;
  a row carries no identity beyond an optional self-offered email. There is no
  account or capability gate by design — requiring sign-in to say "cover my area"
  would be exactly the form-wall the doctrine forbids.
- **Rollback / kill:** durable rows live in `public.area_demand` (migration 0045,
  RLS on, anon/authenticated revoked, service_role only); `truncate
  public.area_demand` is a safe reset. Until the OWNER applies 0045 the store
  fails soft to process-memory (`lib/areaDemandStore.ts`) — capture keeps working
  and becomes durable the moment the table lands, no code change (the same soft
  degradation vibe votes ship with). A hard durable-store write failure answers
  503 `STORE_UNAVAILABLE` rather than a fake success. Disabling is
  consequence-free: delete/503 the route and the preview's capture button fails
  soft to a quiet retry line while the alternative (nearest patch) still renders.

### `app/api/visit-reports` — structured Visit Reports (route 66)

- **Route / method:** `POST app/api/visit-reports/route.ts` (Wayfinder 3.4,
  `lane/visit-reports`). An individual account of one dated visit: observed
  busyness, noise, seating, bar wait, and an optional short note. The route also
  exports read-only `GET` paths for newest-first venue rows and exact visible
  counts by contributor. Neither read carries a score, average, or aggregate
  verdict, and neither is counted as a mutating verb.
- **Validation:** `validateVisitReport` (`lib/visitReports.ts`) requires the
  venue plus the handle derived from the authenticated account; body handles
  are ignored. Every structured field is coerced to a fixed allowlist (unknown
  → null, mirrored by the DB CHECK constraints in migrations 0046 and 0058);
  the note is cleaned, capped at 140 chars, and **slop-filtered at write time**
  (`lib/slopFilter`); `visitedAt` resolves to a London day key (a bare
  `YYYY-MM-DD` is taken verbatim and must be a real calendar day; a full
  timestamp folds through the London "evening date", so pre-dawn hours belong to
  the night before), and a date later than today in London or older than
  `MAX_VISIT_AGE_DAYS` (90 calendar days, both ends inclusive) is rejected —
  the date is authority-bearing because the public
  lane sorts on it, so the window is enforced HERE and the composer's `min`/`max`
  only mirror it; at least ONE signal must survive or the body 400s
  (`INVALID_REPORT`) before the limiter/store is touched.
- **Rate limit (boundary):** durable per-profile + hashed-IP `isLimited` with key
  `visit-report:${contributor.actor}:${ipHash}` (raw IP never keyed) —
  429 `{ code: "RATE_LIMITED", retryable: true }` on exceed. The public `report`
  action carries the same two-axis flood cap as Pint Drops (per-target + a
  per-actor budget of 1). This is the certification boundary (rate_limit class).
- **Moderation (boundary):** the `restore` / `hide` actions require the admin
  token (`isModerator` — moderator class). A public `report` records a
  per-actor-deduped flag but never changes visibility; this prevents an
  anonymous flag from becoming a one-tap eraser. Flagged, undecided rows surface
  in the admin moderation queue (`GET ?status=reported`), where a moderator can
  keep one visible or hide it without deleting its provenance. A hide is
  reversible from the same surface that made it: hidden rows keep their own
  moderator lane (`GET ?status=hidden`), carrying the identity a `restore` needs
  to put the account back on public reads.
- **Auth stance:** creation requires `resolveContributionIdentity`, which
  derives public attribution and the private actor from the authenticated
  account's immutable profile id. Missing or expired auth returns
  `sign_in_required`; incomplete profile setup returns `onboarding_required`.
  Creation pauses under the solo-operator social freeze; reporting and
  moderation stay open. Historic unlinked rows keep their stored attribution.
  One report per handle per venue per night: the store upserts on
  `(venue_id, handle, visited_at)`.
- **Rollback / kill:** durable rows live in `public.structured_visit_reports`
  (migrations 0046 + 0058, RLS on, anon/authenticated revoked, service_role only
  — a NEW table, distinct from the Pint Drop `visit_reports` table); `truncate` is
  a safe reset. Until the OWNER applies both migrations the store fails soft to process-memory
  (`lib/visitReportsStore.ts`) — capture keeps working and becomes durable the
  moment the table lands, no code change (the same soft degradation area demand
  ships with). A hard durable-store write failure answers 503
  `STORE_UNAVAILABLE` rather than a fake success. Disabling is consequence-free:
  delete/503 the route and the venue-sheet panel says it could not check rather
  than claiming no visits exist.
- **V1 moderation gap:** the queue is manual and reactive. It has no automated
  text classification, appeals, bulk actions, moderator assignment, or response
  target. The storage and public flag seam preserve all information needed to
  add those workflows later.

### `app/api/night-moments/[id]/alt-text` — author-confirmed alt text (route 67)

- **Route / method:** `PATCH app/api/night-moments/[id]/alt-text/route.ts`
  (Wayfinder 5.6, `lane/alt-text-authoring`). The author confirms (or clears) the
  alt-text description on their OWN photo Moment — the act that unblocks that
  photo for publication. A private authoring write, never itself a publication.
- **Validation:** body `altText` normalised by `cleanText(..., 200)` in
  `setMomentAltText` (`lib/nightMemoryStore.ts`); an over-long pre-normalisation
  payload 400s early. A non-empty description gains a fresh server-stamped
  `altTextConfirmedAt`; an empty one clears the stamp (and re-blocks the photo).
- **Auth stance (boundary):** `callerUserId` (account class). `setMomentAltText`
  additionally refuses unless the caller OWNS the Moment AND it carries media —
  a non-owner or a non-photo Moment answers 403. No account/memory identifiers
  are returned (mirrors the other Night surfaces).
- **Publication gate (belt & braces):** the description feeds the single publish
  choke — `proposeNightStoryPublication` / `confirmNightStoryPublication` refuse
  any selected photo Moment lacking author-confirmed alt text (naming it via
  `findPublishAltTextGap`), and `getPublishedRecapSource` never emits an
  UNCONFIRMED description as author text — composed AFTER the 5.5 redaction belt
  (departed contributors' media is dropped first; the alt-text belt then only
  touches surviving media). Private Memory saves never consult it.
- **Grandfathering:** already-published Stories are never retroactively
  unpublished; a pre-gate photo simply reports "no confirmed description" and its
  media still emits (the recap belt only nulls the unconfirmed text, not the
  photo). The gate applies to publishes going forward.
- **Rollback / kill:** durable in the additive `night_moments.alt_text` /
  `alt_text_confirmed_at` columns (migration 0047 — additive, idempotent, length
  CHECK ≤ 200; the OWNER applies with this release). Reads tolerate the columns'
  absence (report null); a Moment saved without a description never references
  them, so private capture keeps working pre-apply. Disabling is
  consequence-free: 503/remove the route and photos simply can't be described
  (and so can't be published) until it returns.

## Internal cron routes (excluded from the mutating-verb inventory)

The Vercel cron freshness plane schedules routes under `app/api/cron/*`
(inventory: `vercel.json`; runbook: `docs/CRON_PLANE_RUNBOOK.md`). They
are **mutating by effect** (weather writes to the durable `weather_snapshots`
store; What's-On stamps `feed_freshness`) but are deliberately **NOT counted in
the mutating-route inventory** (see the count at the top of this document), for
the same reason token-gated `GET`
confirm/unsubscribe endpoints are excluded:

- **They are `GET` handlers.** Vercel Cron dispatches `GET` (its dispatcher also
  accepts `POST`); the inventory scans for public `POST/PUT/PATCH/DELETE`
  handlers (`MUTATION_EXPORT`), which these do not export. The structural count
  is therefore unchanged by them.
- **They are internal, `CRON_SECRET`-gated schedulers, not a public surface.**
  Authority is `Authorization: Bearer $CRON_SECRET` enforced twice — by Vercel's
  cron dispatcher and again inside each handler (`lib/cronAuth.ts`,
  constant-time compare; unset secret in production ⇒ `401`, refuses to run).
  This is the certification boundary for these routes (an internal-secret gate,
  analogous to the moderator token) even though they are not part of the
  public mutating-verb tally.
- **Failure posture is no-fake-success:** provider outage ⇒ `502` with nothing
  written; durable write failure ⇒ `503`; per-area contract failures are skipped
  and reported. See `docs/CRON_PLANE_RUNBOOK.md`.

If a cron route is ever converted to a `POST` (or a public mutating verb is added
under `app/api/cron/*`), it MUST be folded into the inventory count in the same
commit.

### `app/api/venue-operators/claim` — venue operator claim (route 68)

- **Route / method:** `POST app/api/venue-operators/claim/route.ts` (Wayfinder
  3.5, `lane/operator-rail`). A signed-in account claims to run a venue and
  records HOW it can be verified (an email on the venue domain, a phone behind the
  bar, a document). v1 only RECORDS the claim; the OWNER verifies it manually in
  the admin queue. The route also exports a read-only `GET` (the caller's OWN
  claim state, or the moderator review queue) which is NOT a mutating verb and is
  not counted.
- **Validation:** `validateOperatorClaim` (`lib/venueOperators.ts`) — `venueId`
  required (≤ 120 chars), `evidenceKind` ∈ {`email-domain`, `phone`, `document`},
  a cleaned/capped (≤ 500) non-empty `evidenceNote`. Malformed bodies 400
  (`INVALID_CLAIM`) before the limiter/store is touched; the DB CHECK constraints
  in migration 0048 mirror the allowlists.
- **Auth stance (ACCOUNT — the CREATE boundary):** `account_id` is the VERIFIED
  Supabase uid from the bearer JWT (`callerAuthIdentity`), never a body value; an
  anonymous caller is 401. Idempotent per `(account_id, venue_id)` — a re-claim
  UPDATES in place and reopens the row to `pending`, so table growth is bounded by
  distinct account×venue pairs.
- **Rate limit (boundary):** durable per-account + hashed-IP `isLimited` with key
  `venue-operator-claim:${accountId}:${hashIp(clientIp)}` (raw IP never keyed),
  budget 10 — an operator may run a few pubs. 429 `{ code: "RATE_LIMITED",
  retryable: true }` on exceed. This is the certification boundary (rate_limit
  class).
- **Moderation (boundary):** `verify` / `reject` / `revoke` require the admin
  token (`isModerator` — moderator class); they set the verification state and
  stamp the review. Verification is the gate a proposal must pass (see route 69).
- **Freeze stance:** deliberately NOT wired to the solo-operator SOCIAL freeze — a
  venue operator asking to be verified is venue-BUSINESS content, not a social
  post. The freeze seam is intentionally absent (documented exemption).
- **Rollback / kill:** durable rows live in `public.venue_operators` (migration
  0048, RLS on, anon/authenticated revoked, service_role only); `truncate` is a
  safe reset. Until the OWNER applies 0048 the store fails soft to process-memory
  (`lib/venueOperatorsStore.ts`) — the flow keeps working and becomes durable the
  moment the table lands. A hard durable write failure answers 503
  `STORE_UNAVAILABLE`, never a fake success.

### `app/api/operator-proposals` — reviewed operator proposals (route 69)

- **Route / method:** `POST app/api/operator-proposals/route.ts` (Wayfinder 3.5,
  `lane/operator-rail`). A VERIFIED operator proposes an attributed, structured
  update (`correction` / `event` / `offer` / `response`) that routes through
  REVIEW. The route also exports a read-only `GET` (the moderator review queue by
  status) which is NOT a mutating verb and is not counted.
- **Validation:** `validateOperatorProposal` (`lib/operatorProposals.ts`) —
  `venueId` + `type` required; the flat structured payload (title/body/field/
  startsAt) is cleaned/capped and must carry the type's required fields
  (correction → field+body, event → title+startsAt, offer → title+body, response
  → body) or 400 `INVALID_PROPOSAL`.
- **Auth stance (ACCOUNT + CAPABILITY — the CREATE boundary):** `account_id` is
  the VERIFIED uid (`callerAuthIdentity`; anonymous → 401), AND the caller must
  ALREADY be a VERIFIED operator of the venue
  (`venueOperatorsStore().isVerifiedOperator`) or the proposal is 403
  `NOT_VERIFIED_OPERATOR`. The verification check fails CLOSED on a storage wobble
  (returns false), so no proposal slips through unverified.
- **Rate limit (boundary):** durable per-account + hashed-IP `isLimited` with key
  `operator-proposal:${accountId}:${hashIp(clientIp)}`, budget 20 — 429
  `{ retryable: true }` on exceed. This is the rate_limit-class boundary; the
  route also carries the moderator class (accept/decline).
- **Moderation + the admin acceptance seam (boundary):** `accept` / `decline`
  require the admin token (`isModerator`). TRUSTED DATA IS UNTOUCHED — a proposal
  NEVER writes a venue fact. Only the `accept` branch (the admin acceptance seam)
  materialises an accepted payload into served evidence, and even then only as a
  `FactSource` of authority `operator` (rank 0, `factClaims.
  acceptedProposalFactSource`): additive, attributed, and exposed as a CONFLICT if
  it disagrees with the observed corpus, never a silent overwrite. A fence test
  (`__tests__/operatorProposalFence.test.ts`) asserts the proposal store/module
  import NO venue-fact module — the acceptance route is the sole bridge.
- **Freeze stance:** NOT under the SOCIAL freeze (venue-business content), same
  exemption as route 68.
- **Rollback / kill:** durable rows live in `public.operator_proposals` (migration
  0048, RLS on, anon/authenticated revoked, service_role only); `truncate` is a
  safe reset. Fails soft to process-memory until 0048 lands
  (`lib/operatorProposalsStore.ts`); a hard write failure answers 503.

### `app/api/price-submit` - community price and venue-signal submissions (route 70)

- **Route / method:** `POST app/api/price-submit/route.ts` (`fm/price-submission`).
  A drinker standing in the pub logs tonight's price for one drink category; it
  shows on the venue sheet at once, and the pin/card restamp only after the
  trust gate (second independent submitter, 30-day window - policy in
  `lib/communityPrice.ts`). Sibling of `POST /api/price-confirm`, which only counts
  vouches for an already-displayed figure; this is where a figure first enters
  the map from the community. It is no longer the only door: a Round's itemised
  drink lines (`POST /api/rounds/[code] { action: "recordSpend" }`) reach
  `submitCommunityPrice` only when the writer passes the same authenticated
  account and public-handle boundary. Anonymous lines remain in the private
  Round diary. Direct and Round price
  writes use the account's stable profile actor. The same POST also carries the
  community VENUE SIGNAL shape (`{ kind: "venue-signal", venueId, signalKey,
  signalValue }` → 201 `{ ok, signal }`): a categorical observation of
  character, step-free entrance, step-free toilets, door policy or whether people are eating
  (`lib/communityVenueSignals.ts`). It is a second shape, not a second route -
  deliberately, so it inherits this route's identity, limiter and moderation
  boundaries rather than growing a parallel set. The route also exports
  read-only `GET` branches - the freshest community prices AND venue signals
  for a venue (`?venueId=` answers `{ prices, signals }`, with `degraded: true`
  when either read could not be trusted, so "could not check" never reads as
  "none"), the cross-venue no-alcohol lens index (`?lens=no-alcohol`), and
  `?scope=provisional-base`, which answers which of up to
  `MAX_PROVISIONAL_BASE_VENUE_IDS` on-screen `venue-uk-*` pins carry a fresh
  uncorroborated pint report. Every id on that branch is validated as a stable
  salted base id server-side and the answer carries ids only, never a figure,
  so viewport visibility cannot reach the price merge. None of the three is a
  mutating verb and none is counted.
- **Validation:** `validateCommunityPrice` (`lib/communityPrice.ts`), the SAME
  browser-safe validator the submit UI runs, so client and server can never
  drift - `venueId` cleaned/capped at 64 chars, `drinkCategory` restricted to the
  closed `DRINK_CATEGORIES` union, and `priceGbp` held to the plausible envelope
  £1 - £30. Out-of-envelope or malformed input 400s with reader-facing copy before
  the limiter or store is touched; the store re-checks the penny envelope and
  migration 0054 adds the same CHECK, so three layers agree. The `venueId` must
  also exist in the slim venue index (`getVenueIndex`), or - for a `venue-uk-*`
  id - in the UK base id index (`lib/ukBaseIndex.ts`); an unknown id 400s
  without storing anything, and when the index itself is unavailable (its
  documented degraded mode is an empty map) the route answers 503 (retryable),
  never a 400 and never a stored row. The venue-signal shape runs the same venue
  resolution (pub kinds and `venue-uk-*` ids only, same 400/503 split) behind
  `validateCommunityVenueSignal`, whose `signalKey`/`signalValue` pairs are a
  CLOSED vocabulary the browser and the server share and migration 0060 repeats
  as a CHECK, so an off-vocabulary answer cannot be stored by any door.
- **Auth stance:** price and venue-signal writes require a verified account,
  account-owned public handle, and completed private profile. Both public
  attribution and the private `profile:<profile-id>` actor are derived on the
  server. Body-supplied handles, actors, `submittedAt`, and `source` are
  ignored. This stable profile actor is the de-duplication and corroboration
  key and never leaves the store. The reader-report branch stays public and
  uses its separate abuse-controlled actor because reporting an existing row
  is not a contribution.
- **Rate limit (boundary):** two durable `isLimited` tiers on the POST. An
  account-wide cap keyed `price-submit-actor:profile:<profile-id>` (30/hour)
  stops one account spraying observations across the whole map by rotating
  `venueId`; then `price-submit:profile:<profile-id>:${venueId}` stops the same
  account churning one pub's figure. Exceed either → 429. Both tiers are one
  helper (`communityWriteIsLimited`) and a venue-signal write charges the SAME
  two keys, so signals cannot buy extra budget or spray one pub. An authorised
  Round's drink lines use the same account-actor key namespace and cap, charged
  one unit per line before a saved pending line becomes ready for promotion
  (`lib/roundPriceBudget.ts` owns that budget and its degraded allowance, which
  answers 503 with `Retry-After` rather than 429, because a spent degraded
  allowance is our limiter being unreachable, not the drinker's doing). The
  `?scope=provisional-base` READ carries its own durable tier keyed
  `provisional-base:${actor ?? "anon"}` (120 per minute, refused with
  `Retry-After`): unlike the other two GET branches it pages the durable store
  per request, so a scripted sweep of the country is budgeted while a session
  of panning - which asks only for ids it has not already read - sits well
  inside it.
- **Provenance (the honesty boundary):** the route only ever APPENDS to
  `community_prices`. It touches NOTHING in the versioned venue dataset, the
  scraped price CSV, or `visit_reports` - a submission cannot overwrite a scraped
  or sourced price. The venue sheet renders the community price on its own dated,
  badged row ABOVE the price on record, which still renders untouched. A venue
  signal is held to the same line: it is an OBSERVATION, never a venue fact, so
  it never edits the dataset's amenity, access or character fields and the sheet
  words it as drinkers' reports (`lib/communityVenueSignals.ts` owns that copy
  and the `unknown` | `reported` | `established` trust states a surface may read).
  The only row a signal write can touch is this account's own earlier answer to
  the same question, which it replaces.
- **Rollback / kill:** durable rows live in `public.community_prices` (migration
  0054, with optional contributor attribution and retained quality stamps added
  by migration 0059; RLS on, no anon/authenticated policy, service_role only).
  `truncate` is a safe reset and cannot damage dataset prices. Migration 0060
  widens that one table to hold venue signals too - nullable
  `drink_category`/`price_pennies` plus `signal_key`/`signal_value`, a CHECK that
  a row is exactly one shape, and a unique `(venue_id, signal_key, actor)` so
  one actor answers each question once. Its revoked
  `public.community_contributor_counts` view remains an internal actor-key
  roll-up and does not feed the public contributor record. Dropping the two
  signal columns reverts that surface without touching a price. Until 0054 is
  applied the store fails soft to process-memory outside production
  (`onMissingDurableWrite` refuses the ephemeral fallback in a deployed
  production instance), so keyless dev keeps working; a hard durable write
  failure answers 503, never a fake success.

### `app/api/admin/community-prices` - community observation moderation (route 71)

- **Route / method:** `POST app/api/admin/community-prices/route.ts`
  (`fm/trust-quickfixes`), actions `hide` and `restore` on ONE community
  observation. The receiving side of route 70: until this existed, a wrong or
  malicious community price had no moderator removal path, and the only
  remediation was hand-written SQL. The route also exports a
  read-only `GET` (the reported/hidden review queue) which is NOT a mutating verb
  and is not counted. ONE queue, TWO shapes: each queue row says which it is
  (`kind`), so a wrong character or step-free claim is removed here rather than
  through a second console or a second API.
- **Auth stance:** moderator-gated by `isModerator` (`lib/adminAuth.ts`) on BOTH
  verbs - the `x-admin-token` header or the httpOnly admin session cookie, never
  a query-string token; with `ADMIN_TOKEN` unset the gate opens only in dev/test,
  so a preview deploy is never wide open. Same gate as the Pint Drop and comment
  queues.
- **Validation:** `action` restricted to `hide` | `restore` (anything else 400s,
  and there is deliberately no `delete`), `id` required (400 when missing, 404
  when unknown), and the free-text `note` is control-char-stripped and capped at
  280 chars in the store.
- **Reader-side flag (no new route):** readers complain through the existing
  `POST /api/price-submit { action: "report", id }` - the id of EITHER shape,
  carried on the venue read - which is durably
  one-report-per-actor (`community_price_reports`' unique pair) plus two
  `isLimited` tiers. Reporting NEVER auto-hides - unlike Pint Drops, whose
  threshold auto-hide is safe because a drop is one person's post; a community
  price is the figure the map is made of, and an anonymous threshold here would
  be a one-tap eraser for any price a griefer disliked.
- **Hide, never delete (the honesty boundary):** `hide` stamps `hidden_at`; the
  observation, its answer, its date and its report metadata all survive, so a
  wrong call is one `restore` away and the audit trail is intact. Each shape is
  filtered in ONE place in `lib/communityPriceStore.ts` (`freshestPerCategory`
  for prices, `freshestVenueSignals` for venue signals), so a hidden price leaves
  the venue sheet, the corroboration count, and the map candidate together, and a
  hidden signal leaves the sheet, the corroboration count and the established
  answer together - there is no second place that can remember either.
- **Rollback / kill:** the columns and the report ledger live in migration 0055
  (`community_prices.hidden_at` et al. + `public.community_price_reports`, RLS
  on, no anon/authenticated policy, service_role only), and cover venue signals
  unchanged because 0060 keeps them in the same table. Clearing `hidden_at`
  restores everything; the store fails soft to process-memory until 0055 lands,
  and an unavailable durable read degrades the queue to empty rather than 500.

### `app/api/weather-recommendations` - authored weather Recommendations (route 72)

- **Route / method:** `POST app/api/weather-recommendations/route.ts`
  (`fm/weather-recommendations`) creates or updates one Pubmaxxer's opinion for
  one venue and condition. The same POST accepts moderator-only `hide` and
  `restore` actions for one row. Its `GET ?venueId=...` is read-only and is not
  counted.
- **Validation:** `validateWeatherRecommendation`
  (`lib/weatherRecommendations.ts`) is shared by client and server. It requires
  a canonical venue, normalized Pubmaxx handle, 8 to 160 character plain
  reason, and exactly one closed condition from `warm`, `clear`, `raining`,
  `cold`, or `windy`. The database repeats those bounds. Unknown venues and
  off-vocabulary conditions are rejected before persistence.
- **Identity and attribution:** creation requires
  `resolveContributionIdentity`, which derives the public handle and a
  profile-based actor (`profile:${profile.id}`) from the authenticated account's
  immutable profile id. Body handles are ignored. Missing or expired auth
  returns `sign_in_required`; incomplete profile setup returns
  `onboarding_required`. Historic unlinked rows keep their stored attribution.
  The handle is public authorship; the actor never leaves the store and is never
  accepted from the body.
- **Rate limit (boundary):** an actor-wide durable `isLimited` budget keyed by
  the profile-based actor allows 30 writes per hour across venues. A second
  per-actor, per-venue budget allows five per hour. One natural row per
  `(venue, condition, contributor_handle)` means edits under the same handle
  replace the author's earlier reason rather than increasing their contribution
  count.
- **Moderation (boundary):** `hide` and `restore` require `isModerator`; a
  reader cannot hide a Recommendation. Hiding is reversible, keeps authorship
  and moderation provenance, removes the row from venue reads and contributor
  counts together, and never deletes it.
- **Weather and read honesty:** the GET uses only the existing store-first
  Open-Meteo snapshot and nearest Night Area. Known current conditions filter
  human-authored rows. Missing, future, or expired weather returns
  `weatherStatus: "unavailable"` and surfaces authored rows unconditionally, so
  "we could not check" never becomes "nobody recommended this". Weather never
  authors, verifies, scores, or ranks a Recommendation.
- **Payload and contributor-record seam:** venue reads start from at most 20 newest
  rows and enforce an 8 KiB serialized response ceiling, reporting `truncated`
  if the runtime ceiling removes any. `countForContributor` derives the visible
  count for profile surfaces, while the public contributor record combines
  visible Recommendations with its other identity-backed lanes. Neither count
  nor any aggregate score or venue rank appears in this venue API response or
  the venue UI.
- **Rollback / kill:** durable rows live in
  `public.weather_recommendations` (migration 0058, with moderation fields and
  the contributor-record aggregate added by 0059; RLS on, anon/authenticated
  revoked, service-role only). A missing migration falls back to memory outside
  deployed production; production writes fail with 503. Reads carry `degraded`
  when durable storage cannot answer. Truncating this table removes authored
  Recommendations and their contributor counts, but cannot change weather,
  reviews, prices, Night Signals, or venue data.

### Contributor identity onboarding

- **Routes / methods:** `POST` and `PATCH` on
  `app/api/identity/onboarding/route.ts` claim an account-owned handle and edit
  optional private full name and sex. Date of birth is required on the signup
  POST. Its sibling GET is read-only.
- **Authority:** every method derives the account from a verified Supabase JWT
  through `callerUserId`. Missing authority returns 401 before any read or
  write. Handle ownership is enforced transactionally by
  `complete_contributor_onboarding`; reserved handles are rejected by shared
  code policy.
- **Privacy:** date of birth, optional full name and optional sex stay in the
  private account table and are not returned by public profile routes. Date of
  birth stays until profile deletion; full name and sex stay until edited,
  cleared or profile deletion. No contribution eligibility is derived.

## Certification command

```bash
npx vitest run __tests__/writeSurfaceCertification.test.ts __tests__/rateLimit.test.ts
```

## Production evidence — 17 July 2026

- The production `check_rate_limit` RPC returned `false`, `false`, then `true` for
  three sequential hits against a limit of two. The disposable certification row
  was removed immediately afterward.
- Both Vercel production projects, `chengdu` and `pubmax`, contain the required
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`, and `ADMIN_TOKEN`
  variable definitions. Values are sensitive and are never printed or committed.
- Route and limiter tests prove the fail-closed option returns the documented 429
  path before a Plan or paid-provider request proceeds.

The structural scan, live atomic-limiter check, and deployment configuration must
all remain green. A future route added without a reviewed boundary fails the closed
inventory count and boundary assertions in CI.
