# Mutating API surface certification

Wave 0 treats every exported `POST`, `PUT`, `PATCH`, or `DELETE` handler as a
reviewed surface—even when a POST is semantically read-only. The regression test
`__tests__/writeSurfaceCertification.test.ts` scans the complete `app/api` tree.
Adding a sixty-second mutating route or removing its authority/abuse boundary fails
CI until this certification is deliberately updated.

> **Inventory: 64 mutating routes.** The count grew 60 → 61 (email-capture
> `POST /api/email-subscribers`) → 62 (native `POST /api/push-tokens`) → 63 (the
> Social Loop "we're out" `POST /api/check-ins`) → 64 (the vibe-vote
> `POST /api/plans/[id]/vibe-votes`). Token-gated GET confirm/unsubscribe
> endpoints and read-only GETs (the Social Loop reads, the vibe-vote tally read)
> are deliberately excluded from the mutating-verb inventory. The number is a
> merge-conflict coordination point across in-flight branches — reconcile it (not
> silently overwrite) when branches meet.

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
