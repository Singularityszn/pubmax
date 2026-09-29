# PUBMAXX metric definitions

Owner: captain. This file defines the adopted group outcome and supporting event
measures: what each counts, its denominator, and its limits.
`docs/analytics/TRACKING_PLAN.md` says what each EVENT answers and owns the release
metric. The event registry owns names and props (`lib/analyticsEvents.ts`).

Section 1 governs event queries. The private store aggregate in section 2.2 uses
completion snapshots and does not depend on event consent or attribution.

## 1. The clauses every query carries

### 1.1 Environment and release

Every event carries three attribution properties, stamped by
`lib/analyticsAttribution.mjs` on both transports:

| Property | Meaning |
|---|---|
| `environment` | `production`, `preview`, `development` or `internal-test`. Nothing else exists |
| `release` | The first 7 characters of the commit the build was made from. Absent when the build could not name its commit |
| `schema_version` | The version of the envelope. `2` is the first version that carries this table |

A product figure is a figure about `production`. Every query in this file therefore
opens with the same fragment, and a query that omits it is answering about a mixture
of drinkers, reviewers and our own browser suite:

```sql
AND properties.environment = 'production'
```

Two rules ride with it.

1. **A row with no `schema_version` is unattributed, never production.** Version 1 is
   every row written before the attribution shipped. It states nothing about where it
   came from. A trend that crosses that date is read as two series, or the window
   starts after it. History is never reinterpreted.
2. **`$host` is not the filter.** Browser SDK events carry `$host` because the SDK
   sends it. A named product event is sent from the server and carries no host at
   all, by design: a preview host is generated per deployment, so it is high
   cardinality and names a machine rather than a lane. `environment` is the one
   filter that works across both transports.

### 1.2 What may count as a kept action

A kept action is an outcome the server already wrote down. Only these ride the
verified delivery lane, which mints a signed token from the durable subject, claims a
receipt before the event is forwarded, and refuses a repeat of the same subject:
`plan_draft_saved`, `plan_accepted`, `crew_committed`, `plan_completed`, and
`meaningful_core_action` with `action` of `plan_accepted` or `plan_completed`
(`app/api/events/route.ts`, `lib/verifiedAnalytics.server.ts`,
`lib/analyticsReceiptStore.ts`).

Three consequences.

- A failed or cancelled action mints no token, so it can never reach these figures.
- A retried delivery reports the same night once. `crew_committed` is keyed on the
  plan and its night, `plan_completed` on the completion, so a repeat is refused as
  already delivered.
- Every other event is an impression or an attempt. An impression may be half of a
  ratio. It is never a kept action.

### 1.3 The three limits inherited from the tracking plan

Named events carry no `$session_id`, a named event's page is `path` rather than
`$pathname`, and no account identity ever joins the pseudonymous id (ADR 0009).
Section 1 of `docs/analytics/TRACKING_PLAN.md` owns those facts. A window over
`distinct_id` is the only session-shaped tool available.

## 2. The adopted outcome: weekly repeating group nights

**The contract.** Count completed Planned Nights with at least two participating
accounts, then count those whose group completed another Plan in the prior 28 days.
The week labels the later completion. This store measure and the consenting-device
event proxy below answer different questions.

The event stream describes a narrower planning sequence. It remains useful for
tracking where nights drop out:

A night qualifies when all three are true.

1. **It is an eligible plan.** A host accepted a route (`plan_accepted`, verified).
2. **A second person joined it.** At least one participating account other than the
   host committed to that plan. The server proves this rather than the browser:
   `POST /api/plans/[id]/join` mints a `crew_committed` token only for the join that
   first takes the roster to two, and the token's subject is the plan and its night,
   so one plan-night reports one crew night however many guests arrive.
3. **It was completed explicitly.** Somebody saved an ending for that night
   (`plan_completed`, verified). A night that simply stopped is not a completion.

The event proxy calls a repeat when the same `distinct_id` qualifies again in the
following ISO week. That is not the adopted 28-day group repeat.

**Guest-only participation is a separate line.** A person who joins other people's
nights and never hosts one is a real pattern. `crew_committed` is emitted by the
joining guest's device, so guests can appear in the device proxy. The fuller
guest-only depth remains unmeasured. The unused `guest_plan_participated` event was
removed from the registry (section 6 of the tracking plan).

### 2.1 What the stream can answer today

The three clauses above are each measurable. What is NOT measurable today is clauses
2 and 3 for the SAME night, and the honest reason is a good one: no plan identifier
crosses the wire, so a `crew_committed` from a guest's device and a `plan_completed`
from whoever saved the ending cannot be joined at row level.

The event proxy reports weekly counts and a device repeat rate. Read these together,
but do not label them group outcomes:

```sql
-- Weekly crew nights, completions, and the devices behind them.
SELECT
    toStartOfWeek(timestamp) AS week,
    countIf(event = 'plan_accepted')  AS accepted_plans,
    countIf(event = 'crew_committed') AS crew_nights,
    countIf(event = 'plan_completed') AS completed_nights,
    uniqIf(distinct_id, event IN ('crew_committed', 'plan_completed')) AS crew_or_completing_devices
FROM events
WHERE event IN ('plan_accepted', 'crew_committed', 'plan_completed')
  AND properties.environment = 'production'
  AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY week
ORDER BY week
```

```sql
-- Repeat: devices that qualified in one week and qualified again in the next.
WITH weekly AS (
    SELECT DISTINCT distinct_id, toStartOfWeek(timestamp) AS week
    FROM events
    WHERE event IN ('crew_committed', 'plan_completed')
      AND properties.environment = 'production'
      AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT
    earlier.week AS week,
    count() AS qualifying_devices,
    countIf(later.distinct_id != '') AS repeated_next_week
FROM weekly AS earlier
LEFT JOIN weekly AS later
    ON later.distinct_id = earlier.distinct_id
   AND later.week = earlier.week + INTERVAL 7 DAY
GROUP BY week
ORDER BY week
```

The repeat denominator is the devices that qualified in that week. It is a device
count, not a people count, and it may never be reported as one.

### 2.2 The private completed-group measure

`pubmax_private.completion_group_week(p_day)` returns one row for the UTC ISO week
containing `p_day`. `groups_completed` counts completion-time snapshots with at
least two distinct active account identities. A revoked Plan member, an unlinked
guest seat, and an inactive Social Crew member do not count. The completion insert
captures membership once; later roster changes do not rewrite it. Completions from
before migration `0169` have no snapshot and remain unmeasured, not zero-member
nights.

`groups_repeated` counts qualifying completions with a qualifying completion of
another Plan in the preceding 28 days. The earlier completion must precede the
later one. At least two account identities must appear in both snapshots. The
private query resolves linked auth and Social identities before comparing them and
counts each account once. A later completion contributes at most one repeat, even
if several earlier completions match.

`repeat_rate` is `groups_repeated / groups_completed` for that week's completed
group cohort. It is `NULL` when `groups_completed` is zero. No median interval is
defined or reported. The query returns counts only to `service_role`; it does not
send account keys or Plan IDs to PostHog. Plan deletion removes its snapshots.
Account deletion removes snapshots containing either identity of that account, so
historical counts can decrease after deletion.

The aggregate has PostgreSQL proof in
`__tests__/completionGroupSnapshotEffective.test.ts`. It does not yet prove a
Social-bound Plan completes through the product: the legacy Plan read hides that
Plan and `complete_plan_atomic` returns `not_found`. Do not publish this aggregate
as complete group-outcome coverage until an authorised Social completion path and
its concurrency checks pass. No shared migration or production dashboard is
asserted here.

### 2.3 The completion event crew flag

`plan_completed` used not to say whether the night it ended had a crew: a solo night
that reached its last stop reported exactly what a night of six reported, so
"crew nights completed" could not be stated as a number at all.

It now carries `crewNight`, one low-cardinality boolean saying whether the completed
night's roster reached `CREW_NIGHT_MIN_PARTICIPANTS` (two). Three things make it the
smallest honest close rather than a new identity surface.

- **The server decides it.** The value is minted on the completion receipt
  (`completionLoopEventTokens` in `lib/verifiedAnalytics.server.ts`) from the roster
  the store already answered with, and it is signed into the delivery token, so a
  browser that flips the answer gets a token that no longer verifies and the event is
  discarded rather than counted.
- **It is the same threshold `crew_committed` is minted on** (`lib/crew.ts`), so the
  two halves of the ratio cannot come to mean different sizes of night.
- **It adds no join key.** A plan id, or any per-plan key, would answer the same
  question and is refused: it would link two devices to one night, which is exactly
  the identity join ADR 0009 rules out.

```sql
-- Crew nights completed, as a share of completions.
SELECT
    toStartOfWeek(timestamp) AS week,
    countIf(properties.crewNight = true) AS crew_nights_completed,
    count() AS completed_nights
FROM events
WHERE event = 'plan_completed'
  AND properties.environment = 'production'
  AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY week
ORDER BY week
```

Two limits ride with it. A completion whose receipt was minted before this shipped
carries `ending` alone, so `crewNight` is **absent** rather than `false` on those
rows: filter on `crewNight = true` against a denominator of rows that carry the
property at all, never against every completion ever recorded. And this closes the
crew question for one night; clauses 2 and 3 of the event sequence for the SAME night
still cannot be joined at row level, for the reason 2.1 gives.

## 3. Supporting measures

Every row states its own denominator. A measure with no denominator is a count, and a
count is never reported as a rate.

| Measure | Numerator | Denominator | Read it as |
|---|---|---|---|
| First action within 60 seconds | See TRACKING_PLAN 2.1 | Landings in the same window | The release metric. This file does not restate its query |
| Plan reaches a crew | `crew_committed` in the week | `plan_accepted` in the week | Two weekly counts, never a row-level join. Both are one per plan-night |
| Night completed | `plan_completed` in the week | `plan_accepted` in the week | Includes solo nights |
| Crew night completed | `plan_completed` with `crewNight = true` | `plan_completed` rows carrying `crewNight` at all | Never against every completion: a pre-`crewNight` receipt has no answer. See 2.3 |
| Weekly meaningful pubmaxxers | Distinct `distinct_id` with `meaningful_core_action` | Distinct `distinct_id` with any event | The roll-up in `WEEKLY_MEANINGFUL_CORE_ACTIONS`. Five actions, no impressions |
| Invite opened | `plan_invite_opened` | `plan_invite_sent` | Sends and opens come from different devices. A weekly ratio, not a funnel |
| Near answers served | `near_answer_ready` with `resultBand` other than `0` | All `near_answer_ready` | An empty answer is reported, so the denominator is honest |
| Price loop | `price_submitted` | `price_submit_viewed` | The composer's own funnel. `price_submit_failed` is the third line |
| Loop moments | Each of the six in TRACKING_PLAN 5.10 | Its own pair | Read as pairs. Neither line alone says anything |
| Release health | `web_vital` p75 by `route` | Not a rate | Compare across `release` to see what a deploy moved |

## 4. What this file will not define

- **A revenue or a saving.** No counterfactual exists for what a drinker would have
  paid otherwise, and nothing in the tree derives one (`lib/dealsHonesty.ts`).
- **A person from event data.** Event figures count consenting devices. ADR 0009.
  The private group aggregate compares accounts inside the store and exposes counts.
- **A rate over all traffic.** Consent gates both event transports, so event figures
  describe consenting visitors.
- **A server-minted confirmation.** Nobody consenting stands behind it. TRACKING_PLAN
  section 3, tile 4.
- **A guest-only depth figure.** `guest_plan_participated` was registered and never
  emitted, and is now deleted with the other seventeen orphan names
  (TRACKING_PLAN 6). The honest answer is unchanged: guest depth is unmeasured, and
  it stays unmeasured until a surface sends something.
