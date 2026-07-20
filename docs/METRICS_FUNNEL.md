# Metrics funnel (Wave M)

Four first-class product metrics, computed entirely from the existing
consent-gated analytics rail (`lib/analytics.ts` → `POST /api/events` →
`lib/posthogServer.ts`). No new PII, no fingerprinting, no third-party
additions. Every event below is in the closed registry
(`lib/analyticsEvents.ts`) with an allow-listed prop shape; anything else is
dropped before it can leave the device or land in the log.

Consent gating is unchanged and certified (PR #294): `trackEvent()` no-ops
without explicit analytics consent, and `POST /api/events` re-validates
consent + the pseudonymous anon id server-side before forwarding anything to
PostHog. Nothing in this wave weakens that gate.

## 1. Nights planned / week

**Events (both pre-existing, reused as-is):**
- `plan_created` — fires client-side in `components/plan/PlanComposer.tsx` on
  a confirmed `POST /api/plans` success (the host's own plan).
- `crew_committed` — fires client-side in `components/plan/PlanCrew.tsx` on a
  confirmed `POST /api/plans/[id]/join` success, with `source: "shared-plan"`.

**Dedupe:** the two events are structurally exclusive — a host's own plan
never re-fires `crew_committed` for itself (the host is a member at
creation, not a joiner), and a guest join never fires `plan_created`. So:

```
nights_planned_per_week = count(plan_created, window=7d)
                        + count(crew_committed WHERE source = "shared-plan", window=7d)
```

grouped by the emitting anon/auth id (the `distinct_id` PostHog receives) to
get a per-planner rate.

## 2. Invites per planner (k-factor)

**New events:**
- `invite_created` — `{ inviteId }`. Fires in
  `components/plan/PlanCollaborationPanel.tsx` (`createInvite`) right after
  a host successfully mints a private, one-use invite link
  (`POST /api/plans/[id]/invites`).
- `invite_redeemed` — `{ inviteId }`. Fires in `components/plan/PlanCrew.tsx`
  after a guest's pending session is upgraded to full collaboration via
  `POST /api/plans/[id]/invites/redeem`.

`inviteId` is the invite's own database row id (a server-generated UUID) —
never the raw one-use invite token/capability that appears in the share URL.
It carries no PII and can't be replayed into a session, so it's safe to
transmit purely as a join key. Because it doesn't fit the registry's normal
fixed-enum string allowlist (that allowlist exists to block free text), it
gets its own format-only validator (`isUuidLike` in
`lib/analyticsEvents.ts`) instead of the enum check — everything else about
the sanitizer (unknown props dropped, unknown events rejected) still
applies.

`upgradeMemberInvite` in `lib/planCollaborationStore.ts` was extended to
return this `inviteId` (via a read-only lookup, no RPC/schema change) so the
redeem route can hand it back to the client; it's `null` on an
already-authorized replay, which correctly emits no event (an invite already
counted once should not double-count).

```
invites_created_per_planner   = count(invite_created)   / distinct planners
invites_redeemed_per_planner  = count(invite_redeemed)  / distinct planners
k_factor                      = count(invite_redeemed) / count(invite_created)
```

joining `invite_created.inviteId` to `invite_redeemed.inviteId` gives
per-invite conversion (time-to-redeem, redemption rate per planner) beyond
the raw ratio.

## 3. Return rate (daily basis)

**New event:** `activity_pulse` — `{ dayBucket }`, where `dayBucket` is a
plain integer: whole UTC days since the Unix epoch
(`lib/dailyActivity.ts::dayBucketFromDate`). No timestamp, no session
length, nothing derived from the visitor.

Fired by `components/DailyActivityPulse.tsx`, mounted once in
`app/layout.tsx` (alongside the other render-nothing analytics components).
On mount, if analytics consent is already granted, it compares today's day
bucket against the last one recorded in `localStorage`
(`pubmaxx:last-activity-day:v1`) and fires **at most once per UTC calendar
day** — a repeat visit or reload within the same day never double-counts
(`shouldRecordDailyActivity` in `lib/dailyActivity.ts`).

The event carries the same anon/auth identity as every other event in the
rail (the pseudonymous id from `lib/analyticsIdentity.ts` / `anonymousAnalyticsId()`
in `lib/analytics.ts`) — no new identity concept, no fingerprinting.

```
return_rate(window=Nd) = count(distinct_ids with >= 2 distinct dayBucket values in window)
                        / count(distinct_ids with >= 1 dayBucket value in window)
```

## 4. A2HS (Add to Home Screen) installs

**New events**, all fired by `components/A2HSTracking.tsx` (mounted once in
`app/layout.tsx`), no props:

- `pwa_install_prompt_available` — the browser fired `beforeinstallprompt`
  (Android/Chrome only; the event isn't in the standard DOM lib types, so
  it's attached with an `EventListener` cast). This is the top-of-funnel
  "eligible to install" signal.
- `pwa_install_completed` — the browser fired `appinstalled`, meaning the
  OS-level install actually completed.
- `pwa_standalone_launch` — on mount, `matchMedia('(display-mode:
  standalone)').matches` is true. iOS Safari never fires the two events
  above, so this is the iOS-compatible proxy: any launch of an already-
  installed PWA, on any platform, shows up here.

```
a2hs_install_rate (Android/Chrome) = count(pwa_install_completed) / count(pwa_install_prompt_available)
a2hs_installed_base (all platforms) = distinct ids with >= 1 pwa_standalone_launch
```

## Registry additions

All six new event names were added to `ANALYTICS_EVENTS` in
`lib/analyticsEvents.ts` with their prop allow-lists:

```ts
invite_created: ["inviteId"],
invite_redeemed: ["inviteId"],
activity_pulse: ["dayBucket"],
pwa_install_prompt_available: [],
pwa_install_completed: [],
pwa_standalone_launch: [],
```

## Tests

- `__tests__/analyticsEvents.test.ts` — registry completeness + sanitizer
  behavior for all six new events (UUID inviteId accepted, non-UUID/free-text
  rejected; bounded numeric dayBucket accepted, `NaN`/negative rejected;
  no-prop events ignore any extra input).
- `__tests__/dailyActivity.test.ts` — pure helpers: `dayBucketFromDate`,
  `shouldRecordDailyActivity` (once-per-day dedupe), `parseStoredDayBucket`
  (defensive parsing of a possibly-malformed stored value).
- `__tests__/planCollaborationRoutes.test.ts` (pre-existing, unmodified)
  still passes with `upgradeMemberInvite`'s widened return type — it asserts
  via `toMatchObject`, so the added `inviteId` field is additive.

## Wave 0.5 loop metrics

The closed registry also carries the complete Plan to Memory to Story loop.
All timing comes from server-owned PostHog event timestamps for the existing
pseudonymous `distinct_id`; client-supplied timestamps are ignored. Event props
never include durations, account ids, Plan ids, raw coordinates, free text, or
user content.

| Event | Confirmed seam | Allowed props |
|---|---|---|
| `plan_generated` | A non-empty grounded route returns from `/api/plans/generate` | `stops`, `grounded` |
| `plan_accepted` | The person explicitly locks the preview; original and replay responses return the same server-signed delivery token, while ingest records/forwards it once | `stops`, `grounded` |
| `plan_saved` | The created Plan and its route metadata finish saving | `stops`, `grounded` |
| `claim_started` | The AuthProvider account-preservation claim is submitted to `/api/identity/claim`, excluding handle creation and renames | `source` (`auth`) |
| `claim_completed` | That account-preservation claim succeeds | `source` (`auth`) |
| `plan_completed` | The completion response is checked against canonical completed Plan state | `ending` |
| `memory_reviewed` | The completed Plan's inline editor or full private recap is explicitly opened | `source` (`inline_recap` or `full_recap`) |
| `story_published` | The separate Story publication confirmation succeeds | `visibility`, `contributors`, `moments` |

Activation is the elapsed time from `plan_generated` to the first
`plan_accepted` or `plan_saved` with `grounded = true` for the same
pseudonymous identity. Manual Plans remain visible in the loop events with
`grounded = false`, but do not enter this grounded-route activation measure.
`grounded` on acceptance/save is server-owned: generation returns a two-hour
HMAC proof covering its candidate venue ids and one create idempotency operation.
Plan creation verifies the exact accepted three-stop route against that proof
after canonical Venue Dataset resolution. The proof digest is part of the
durable create request hash, so a replay cannot remove or replace attribution;
the original Plan creation time reconstructs the same result after proof expiry.
Draft storage may retain the signed proof and operation for recovery, but never
a writable grounding boolean. Manual venue edits invalidate both in the composer,
and the API independently fails closed for stale, forged, or cross-operation proof reuse.

Acceptance and completion loop events use a consent-gated verified-delivery
path. Their canonical API responses return stable signed tokens on both the
original response and every idempotent replay. The browser keeps unacknowledged
tokens in a bounded local outbox and retries them. Revoking consent aborts any
active delivery request, clears the outbox, and advances a consent epoch so a
stale response cannot send another item or remove an event queued after consent
is granted again. `/api/events` verifies the
exact sanitized event, claims a service-role-only `analytics_event_receipts`
row, and forwards a stable derived event id as PostHog `$insert_id`. The signed
token, Plan/completion id, and receipt hash are never event props. Provider or
acknowledgement loss leaves the receipt pending for retry; completed receipts
make later submissions no-ops. Verified events use the occurrence time signed
into their token as the provider timestamp, including after a delayed retry;
ordinary events continue to use server receipt time and ignore client-supplied
timestamps. This delivery rail is funnel telemetry only and
does not change the PNC ledger authority below.

Weekly Meaningful Pubmaxxers is the number of distinct pseudonymous identities
with at least one `meaningful_core_action` in a seven-day window. Its `action`
is a fixed enum and can only be one of:

- `plan_accepted`
- `plan_saved`
- `plan_completed`
- `memory_reviewed`
- `story_published`

Route generation, claim steps, generic page views, install signals, and passive opens
do not qualify. Each qualifying event is emitted beside its primary loop event
only after the corresponding product action succeeds. Confirmed Planned Nights
remain defined solely by the durable, service-role-only
`pnc_qualified_completions` view. The browser `plan_completed` event is only
funnel and Weekly Meaningful Pubmaxxers telemetry; it cannot increment or
replace PNC. Loop depth uses `memory_reviewed` after completion, while Story
publication remains separately queryable through `story_published`.
