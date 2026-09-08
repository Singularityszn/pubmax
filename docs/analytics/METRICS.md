# PUBMAXX metric definitions

Owner: captain. This file is the canonical definition of the north star and of every
supporting measure: what each one counts, what it is divided by, and what it may not
be read as. `docs/analytics/TRACKING_PLAN.md` says what each EVENT answers and owns
the release metric; this file says what each NUMBER means. The registry itself stays
the source of truth for names and props (`lib/analyticsEvents.ts`).

Read section 1 before writing any event query. Section 2 defines the separate private store aggregate. Every figure below depends on it.

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

## 2. The adopted outcome: completed groups that repeat within 28 days

PlanAstra sections 1.2 and 8.9 record the accepted M1 outcome. It is separate from the device proxy below.

A qualifying outing has a saved Plan ending and at least two distinct accounts in non-revoked seats at completion.
Each qualifying completion counts once in its London ISO week. Account bindings are not proof of distinct physical people or attendance.
A repeated outing shares at least two accounts with an earlier qualifying completion within 28 elapsed days.
The earlier timestamp must be strictly lower. Exactly 672 hours qualifies; a longer interval does not.
Several earlier matches still count as one repeated outing. No permanent group identity or transitive clustering is inferred.

| Measure | Definition |
|---|---|
| `groups_completed` | Qualifying completions in the requested weekly window |
| `groups_repeated` | Those completions with an earlier qualifying two-account match |
| `repeat_rate` | `groups_repeated / groups_completed`; null for an empty denominator or unresolved history |

This is a backward-looking repeat measure. It is not a forward D1, D7 or D30 retention cohort.
The optional median interval remains unimplemented. Its interval-selection rule is still unspecified.

Migration 0158 captures private account snapshots in the completion transaction. Existing endings receive no historical roster backfill.
Both older completion overloads retain their behavior and capture unattributed snapshots. Only the attributed writer names its environment and release.
Account deletion must clear snapshot account references without reducing original eligible-account cardinality or known completed-group counts.
Surviving overlap can prove repeat. Missing identity leaves other comparisons unresolved; no permanent identity hash may survive deletion.
The aggregate never sends Plan IDs, account IDs, member IDs, handles, coordinates, or messages to analytics.

**Production classification is unresolved.** The source has no authoritative exclusion list for production test accounts.
A production environment stamp identifies the deployment. It does not identify a valid customer or London retention cohort.
The specification must establish trusted provenance, approval and effective times, classification coverage, and an explicit mixed-roster policy.
Whole-outing exclusion is not an accepted default. A reference string and arbitrary account list do not establish trust.
The same rules must qualify target and prior completions. Unknown classification must remain unresolved.
Coverage must include the target window and each full preceding 672-hour interval. No production specification ships with this change.
London ISO bucketing does not establish London population scope. Actual Plan route evidence needs a trusted scope rule.
Unknown or ambiguous location evidence must remain unresolved. All-production counts are not London's retention cohort.

`lib/planGroupOutcomes.server.ts` reads the service-only aggregate. No endpoint, scheduler, or PostHog event is added.
Known counts under `partial` are lower bounds. Unresolved qualification, comparison, or interval coverage prevents an exact rate.
A failed read returns `unavailable`, not zero. With complete history, an empty cohort returns zero counts and a null rate.
Capture coverage starts when migration 0158 is applied; its first 28 days cannot establish complete prior history.

**Source review remains open.** The follow-up to `efe0f58` revises classification, deletion, coverage, and London scope together.
[The review correction contract](GROUP_OUTCOME_REVIEW.md) records the implementation and the missing internal specification.
The prepared tests are not runtime proof. Independent review, SQL proof, and the specification remain release dependencies.
Until then, the 28-day group outcome remains unmeasured. The following existing queries retain their device-proxy meaning.

### 2.1 What the stream can answer today

Accepted, joined, and completed event counts are each measurable. The stream cannot link joining and completion for the same night.
A Plan identifier never crosses the wire, so events from different devices cannot be joined by night.

The existing device proxy remains a pair of weekly figures plus a next-week device repeat rate:

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

### 2.2 Limits of the event proxy

The stream cannot join a guest commitment to a completion on another device for the same night.
A roster-size boolean on `plan_completed` would not supply cross-night account overlap.
Do not substitute that boolean or the next-week device ratio for the adopted M1 store outcome.
Event reports remain restricted to consenting devices. The private store aggregate has a separate, explicitly specified population.

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
- **A physical person.** Event figures count consenting devices. M1 matches account bindings, not physical people.
- **An event rate over all traffic.** Consent gates both event transports. The internal M1 population is specified separately.
- **A server-minted confirmation.** Nobody consenting stands behind it. TRACKING_PLAN
  section 3, tile 4.
- **A guest-only depth figure.** `guest_plan_participated` has no emitter. The
  honest answer is that it is unmeasured.
