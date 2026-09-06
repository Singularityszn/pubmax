# PUBMAXX metric definitions

Owner: captain. This file is the canonical definition of the north star and of every
supporting measure: what each one counts, what it is divided by, and what it may not
be read as. `docs/analytics/TRACKING_PLAN.md` says what each EVENT answers and owns
the release metric; this file says what each NUMBER means. The registry itself stays
the source of truth for names and props (`lib/analyticsEvents.ts`).

Read section 1 before writing any query. Every figure below depends on it.

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

## 2. The north star: weekly repeating crew nights

**The contract.** A group that plans an outing together, completes it, and comes
back the following week.

A night qualifies when all three are true.

1. **It is an eligible plan.** A host accepted a route (`plan_accepted`, verified).
2. **A second person joined it.** At least one participating account other than the
   host committed to that plan. The server proves this rather than the browser:
   `POST /api/plans/[id]/join` mints a `crew_committed` token only for the join that
   first takes the roster to two, and the token's subject is the plan and its night,
   so one plan-night reports one crew night however many guests arrive.
3. **It was completed explicitly.** Somebody saved an ending for that night
   (`plan_completed`, verified). A night that simply stopped is not a completion.

**Repeat** means the same `distinct_id` qualifies again in the following ISO week.

**Guest-only participation is a separate line.** A person who joins other people's
nights and never hosts one is a real and welcome pattern, and folding them into the
host figure would flatter it. `crew_committed` is emitted by the joining guest's
device, so guests already appear in the repeat measure on their own account. The
registry also holds `guest_plan_participated` for the fuller picture, and it has no
emitter today (section 6 of the tracking plan), so guest-only depth is currently
unmeasurable rather than zero.

### 2.1 What the stream can answer today

The three clauses above are each measurable. What is NOT measurable today is clauses
2 and 3 for the SAME night, and the honest reason is a good one: no plan identifier
crosses the wire, so a `crew_committed` from a guest's device and a `plan_completed`
from whoever saved the ending cannot be joined at row level.

So the north star ships as a pair of weekly figures plus a repeat rate, and the pair
is read together:

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

### 2.2 The one gap, and the smallest honest way to close it

`plan_completed` does not say whether the night it ended had a crew. A solo night
that reaches its last stop reports the same event as a night of six. So
"crew nights completed" cannot be stated as a single number today, and this file
does not state one.

The smallest change that closes it adds no identifier and no join key: give
`plan_completed` one low-cardinality boolean prop saying whether the completed
night's roster held two or more people. The completion receipt is already minted on
the server (`completionLoopEventTokens` in `lib/verifiedAnalytics.server.ts`), which
is where the roster is known, so the value is a fact the server already holds rather
than a claim the browser makes. A plan id or any per-plan key would do the same job
and is refused: it would link two devices to one night, which is exactly the identity
join ADR 0009 rules out.

Until that ships, report the pair from 2.1 and say the ratio is not available.

## 3. Supporting measures

Every row states its own denominator. A measure with no denominator is a count, and a
count is never reported as a rate.

| Measure | Numerator | Denominator | Read it as |
|---|---|---|---|
| First action within 60 seconds | See TRACKING_PLAN 2.1 | Landings in the same window | The release metric. This file does not restate its query |
| Plan reaches a crew | `crew_committed` in the week | `plan_accepted` in the week | Two weekly counts, never a row-level join. Both are one per plan-night |
| Night completed | `plan_completed` in the week | `plan_accepted` in the week | Includes solo nights. See 2.2 |
| Weekly meaningful pubmaxxers | Distinct `distinct_id` with `meaningful_core_action` | Distinct `distinct_id` with any event | The roll-up in `WEEKLY_MEANINGFUL_CORE_ACTIONS`. Five actions, no impressions |
| Invite opened | `plan_invite_opened` | `plan_invite_sent` | Sends and opens come from different devices. A weekly ratio, not a funnel |
| Near answers served | `near_answer_ready` with `resultBand` other than `0` | All `near_answer_ready` | An empty answer is reported, so the denominator is honest |
| Price loop | `price_submitted` | `price_submit_viewed` | The composer's own funnel. `price_submit_failed` is the third line |
| Loop moments | Each of the six in TRACKING_PLAN 5.11 | Its own pair | Read as pairs. Neither line alone says anything |
| Release health | `web_vital` p75 by `route` | Not a rate | Compare across `release` to see what a deploy moved |

## 4. What this file will not define

- **A revenue or a saving.** No counterfactual exists for what a drinker would have
  paid otherwise, and nothing in the tree derives one (`lib/dealsHonesty.ts`).
- **A person.** Every figure here counts devices that consented. ADR 0009.
- **A rate over all traffic.** Consent gates both transports, so every figure is a
  figure about consented visitors.
- **A server-minted confirmation.** Nobody consenting stands behind it. TRACKING_PLAN
  section 3, tile 4.
- **A guest-only depth figure.** `guest_plan_participated` has no emitter. The
  honest answer is that it is unmeasured.
