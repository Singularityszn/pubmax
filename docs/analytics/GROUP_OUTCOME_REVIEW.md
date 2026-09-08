# M1 source review corrections

Status: source revision prepared after `efe0f58`. Independent review and runtime verification remain pending.
The initial commit does not implement this contract. This follow-up adds the source changes and focused test cases below.
Migration 0156 is outside this work.

## Prepared implementation

Migration 0158 adds two internal evidence tables beside its completion snapshots.
Only the database owner can register specifications and account evidence. The application has no evidence administration path.
The migration installs no production specification or account classification.

The specification requires an authority reference, approval time, effective times, an explicit mixed-roster policy, and an explicit London scope rule.
The source can represent `exclude_outing` or `eligible_accounts_only`. Neither policy is approved for production.
The supported scope rule is `all_stops_london`. Its presence in the schema is not production approval.
An approved rule outside those supported values requires another source review. Unsupported rules must not be translated silently.
References must be non-identifying internal references, never account IDs, handles, email addresses, or identity hashes.

Positive account classification requires an applicable evidence row. Missing, expired, or overlapping rows remain unknown.
The completion transaction stores original eligible cardinality, cohort eligibility, and per-position eligibility.
Cleared account references retain those non-identifying facts. Cleared eligible positions also supply the identity-loss indicator.
A used specification cannot be updated. Later evidence never reclassifies an existing completion.

The private read selects a registered specification by reference. It accepts no read-time account exclusion array.
Different specification versions remain incomparable. This conservative implementation does not infer version compatibility.
Coverage includes specification validity, capture start, unknown target/prior observations, and unresolved identity comparisons.
Empty intervals still require coverage. Partial counts are lower bounds, and their exact rate stays null.

The server resolves route scope from city packs and culture waypoint lists.
The attributed completion RPC checks both the read revision and ordered Stop IDs against its saved route snapshot.
Unmatched evidence becomes unknown without refusing an otherwise valid ending.
The service response projects aggregate fields only. No new endpoint, scheduler, administration UI, or rollout service exists.

The prepared PostgreSQL cases include controlled join, reactivation, revocation, and deletion orderings.
They use a temporary test-cluster lock barrier. Every barrier connection is terminated and awaited in cleanup.
Those whole-write ordering cases remain unrun. The separate mid-capture reproduction below has now run.

## Confirmed deletion deadlock

One authorized temporary PostgreSQL cluster ran the two mid-capture cases against source `a923efacd` plus the test-only driver.
The run took 7.26 seconds. Both selected tests failed with SQLSTATE `40P01`; the other 57 tests were not selected.
Neither failure came from a timeout or setup error.

The driver installs a test-only statement trigger before snapshot-account insertion, after the completion has acquired crew locks.
A gate connection holds the advisory lock. The completion waits in the trigger.
A second writer first locks the auth account, then deletes it.
The driver observes both wait edges before releasing the gate: completion waits on gate; deletion waits on completion.
Snapshot-account insertion then needs the auth key held by deletion and completes the lock cycle.

| Case | Deletion wait | Result |
|---|---|---|
| Non-host | Clear `plan_crew_members.user_id` | `40P01`; deletion aborted, completion committed |
| Host, also the stored Plan owner | Clear `plans.owner_user_id` | `40P01`; deletion aborted, completion committed |

The tests verified committed completion state and rolled-back deletion state before failing the no-deadlock assertion.
The historical driver remains at commit `2a8bc66e071f929a25e00a5d1e9ba19237da5c07`.
Its two ordinary failing regressions are not marked as expected failures.
No production lock-order or retry change was made for this reproduction.

The following command applies to that historical commit, within an explicitly released PostgreSQL window:

```sh
PUBMAX_PG_MAX_CLUSTERS=1 PUBMAX_RLS_NO_PG=0 node node_modules/vitest/vitest.mjs run __tests__/planGroupOutcomesMigrationEffective.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --configLoader runner --reporter=verbose -t 'mid-capture auth deletion'
```

Each writer has a 12-second statement timeout. The gate has a 20-second timeout; each test has a 30-second ceiling.
Cleanup terminated and awaited gate, completion, and deletion connections, then removed the test trigger and function.
The suite stopped its cluster and returned the slot. Process, cluster-directory, and slot-directory checks found no remainder.
Main and parent received the result and immediate slot release.
The full local run log is `/tmp/pubmaxx-0158-deadlock-repro.log`.

The auth/crew and auth/Plan lock cycles are confirmed defects in that historical source.
The source repair below awaits independent review and runtime proof.

## Prepared lock-order repair

The private helper locks existing owner and crew auth keys in UUID order before calling the original completion body.
It includes revoked crew bindings. It does not lock Plan or crew rows during that first read.
Each original overload retains its capability, Social, revision, arrival, ending, and replay checks.
Only a `completed` result reaches snapshot validation. Refusals and replays return their original results.

The original body holds the Plan row before capture validates its current owner.
Capture then freezes every crew row, including NULL guest seats and revoked seats, in seat-ID order.
It checks actual bound UUIDs against the prelocked set. Equal cardinality alone cannot pass this check.
Only those already locked auth keys may reach snapshot foreign-key checks.
The completion's existing ending action references a crew seat, not an auth account.
The repair adds no profile or Social row lock and preserves existing account-deletion triggers.

Legacy direct seat and owner stamps can change the binding set between reads.
A missing auth key raises private SQLSTATE `P0158` before snapshot insertion.
Each wrapper catches only that signal inside an exception subtransaction.
The failed subtransaction releases its auth, Plan, and crew locks and rolls back its completion writes.
The next attempt starts with a fresh auth read. It never acquires a new auth key under a failed attempt's locks.
There are at most three attempts. Exhaustion raises `40001` with `Plan account bindings kept changing`.
No handler retries `40P01`, `40001`, or arbitrary failures. No app retry was added.

`lib/planStore.ts` maps the SQL error to its existing `{ ok: false, error: "error" }` result.
`app/api/plans/[id]/complete/route.ts` returns the existing retryable 503 `PLAN_COMPLETION_UNAVAILABLE` response.
Its existing message remains `Plan completion is temporarily unavailable.`

Prepared regression schedules cover all three wrappers:

- Completion-first and deletion-first orderings, for host and non-host accounts.
- The waiter's observed auth lock and absence of Plan/crew row-lock modes before release.
- Real profile tombstone and private Social account suspension paths during deletion.
- Direct legacy active-seat, revoked-seat, owner, and same-cardinality replacement writes, with two attempts and one committed ending.
- Bound revoked-seat reactivation with one attempt, proving the existing account was already locked.
- Capability, revision, arrival, ending refusal, and immutable replay boundaries across all three wrappers.
- Three real roster mismatches, with sequence-based attempt counts and no committed ending, snapshot, or seat stamp.
- Injected `40P01` and unrelated SQL errors, each with one attempt and no partial writes.
- Private helper permissions and helper removal during rollback.

Sequence increments survive rollback, so restart tests measure attempts separately from committed state.
Setup errors, statement timeouts, missing wait edges, and deadlocks fail the new schedules.
All connections and test-only triggers are removed in `finally` blocks; suite cleanup stops the owned cluster.
These new schedules have not run. The historical red result is not green proof for this repair.

## Trusted production classification

The current source has no authoritative production test-account classification.
`environment = production` identifies a deployment, including its test traffic.
An arbitrary reference and UUID exclusion array cannot establish an approved population.

Before classification can return known eligibility, an internal specification must establish all these facts:

- Its trusted authority, immutable version, approval time, and evidence source.
- Its effective start and end times, using completion timestamps.
- Its account classification coverage, including how the authority proves that an account is not a test account.
- Its mixed-roster policy, stated explicitly. Whole-outing exclusion is not an accepted default.
- Its treatment of specification changes across the target and prior completion windows.
- Its London population definition, including mixed-city routes and incomplete location evidence.

Names, email patterns, deployment flags, and absence from an unproven list establish none of these facts.
A caller cannot establish trust merely by supplying a nonempty reference.
An empty exclusion list also needs an approved completeness assertion for its effective interval.
Missing approval, expired evidence, unknown account classification, or unspecified mixed-roster semantics must remain unresolved.

Classification belongs to the completion snapshot, with its specification version and applicable evidence times.
The completion transaction must select trusted evidence applicable to that completion timestamp.
Classification must not depend on mutable current account data during a later aggregate read.
Replays must not replace the original classification or roster.
Later approval must not silently classify earlier unknown snapshots.

Apply the same qualification contract to both target and prior completions.
Different specification versions require explicit compatibility evidence before their cohorts can be compared.
No approved production specification ships with this candidate. Its absence remains a publication dependency.
The implementation must not choose a mixed-roster policy to remove that dependency.

## Cardinality and identity deletion

Record the original distinct eligible-account count separately from retained comparison references.
Keep the original bound-account count when classification is unknown; do not label it eligible.
Once qualification is known, account deletion must not reduce the historical completed-group count.

Keep existing account deletion behavior. Foreign keys clear account references.
Retain a non-identifying identity-loss indicator, such as the count of cleared snapshot positions.
Never retain a deleted UUID, replacement hash, or another cross-outing surrogate for that account.
The snapshot's original cardinality, qualification, and specification facts remain unchanged.

Two surviving shared eligible accounts prove repeat, even when another reference has cleared.
Without a known match, missing identity can leave repeat unresolved. It must not become a false result.
An exact negative needs sufficient retained evidence to rule out two shared accounts in every qualifying prior candidate.
Deletion clears an account from every snapshot. Hidden overlap is bounded by the smaller cleared eligible-position count.
A missing account cannot match a surviving account on the other side.
Keep a known repeat in the numerator even when another comparison remains unknown.

## Qualification and interval coverage

Separate target qualification from repeat comparison.
An unknown target cannot enter the qualified denominator, but it must remain visible as unresolved coverage.
Known completed and repeated counts remain labelled lower bounds whenever qualification or comparison is unresolved.
Suppress the exact rate in that state. A failed read remains unavailable, never an empty cohort.

For every target timestamp `t`, inspect the full interval `[t - 672 hours, t)`.
The lower boundary is inclusive. Equal completion timestamps do not establish an earlier outing.
Use elapsed hours, including across both daylight-saving transitions.
London ISO week bucketing is a separate operation and must not define the comparison interval.

Coverage must include these independent gaps:

- Capture starts after any required target or prior interval begins.
- Legacy completions have no snapshot, or use either older unattributed completion overload.
- Target or prior environment, classification, applicable specification, or location scope is unknown.
- Cleared identity prevents a required negative comparison.
- The requested observation window extends beyond the observation time.

Do not infer interval completeness from the absence of stored unknown rows.
Evidence coverage must cover the requested target interval and every required prior interval, including otherwise empty intervals.
A known overlap still proves a lower-bound repeat when overall coverage is incomplete.
Only proven empty cohorts may report zero counts with an undefined rate.

## London population evidence

Plan rows do not persist a city. A London timezone establishes no venue location.
`cityIdFromVenueId` does not establish London for an unprefixed ID.
The fallback borough in `buildVenueIndex` also cannot establish location.

Existing authoritative inputs are the server's city venue packs and city-specific culture waypoint lists.
`readCityVenueIndex` distinguishes a failed city-pack read from a successful empty result.
`planStopResolver` already resolves stored Stop IDs against city datasets and culture waypoint lists.

The source revision captures low-cardinality route location evidence with the immutable completion snapshot.
Resolve actual stored Stop IDs against those datasets, including `place:` Stops.
Bind that result to the same route revision checked by the completion transaction.
A stale route read must not stamp another revision's location.

Capture known city evidence only when the required Stop evidence resolves consistently and without conflicting city membership.
Keep missing packs, unresolved IDs, ambiguous IDs, and mixed-city evidence distinguishable from known London scope.
Do not infer location from titles, handles, timezone, arbitrary ID prefixes, or default labels.
No coordinates or Stop identifiers enter the aggregate response or analytics.

The internal population specification must determine which route evidence qualifies for London's cohort.
Until that rule exists, known route location is evidence, not automatic cohort membership.
Never label an all-production aggregate as London's retention.

## Required source proof before a runtime window

Prepare focused cases for trusted, missing, expired, late-approved, and incompatible classification evidence.
Cover each explicitly approved mixed-roster policy symmetrically in targets and prior candidates.
Keep unsupported policy values unresolved. Do not create a production policy in test fixtures.

Deletion cases must preserve original eligible cardinality and completed counts after references clear.
Cover a surviving two-account match, an uncertain unmatched comparison, and a provable negative.
Assert that deleted identifiers disappear from snapshot and classification storage.

Cover legacy target and prior callers, unknown target scope, unknown prior scope, and empty but uncovered intervals.
Exercise exactly 672 hours and just outside it across both daylight-saving transitions.
Check London ISO bucketing independently.

Prepare known London, known other-city, mixed-city, missing-pack, ambiguous-ID, and `place:` route cases.
Cover a route revision change between location resolution and completion.
Retain atomic failure, replay immutability, authorization, concurrent claim, grants, and rollback cases from the initial candidate.

Only the two red deadlock cases above have run. Other prepared tests and full verification remain pending.
Independent source review and a separately approved runtime window must precede further verification.
The evidence mechanism still needs an approved production specification and its trusted classification source.
This source candidate must not be reported as measured London retention or as M1-ready.
