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
These are prepared cases, not execution results. No PostgreSQL window has been used.

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

No runtime verification has run for this correction. Independent source review must precede a separately approved runtime window.
The evidence mechanism still needs an approved production specification and its trusted classification source.
This source candidate must not be reported as measured London retention or as M1-ready.
