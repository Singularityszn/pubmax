# Supported generic map command repair

Recorded on 4 November 2026 during the authorised review fix.
The starting HEAD was `c86da342be6c3fe4ef1fd3d5fcd3add101ce3f38`.
The evidence covers the working changes before the executor creates a child commit.

## Failure and invariant

The reported finding was legitimate.
Generic map clauses must not alter service meaning, service arguments, or the original query.
This invariant applies to typed dispatch, both voice dispatch paths, discovery constraints, journey endpoints, hours subjects, and price comparisons.
Named-map requests, retained choices, active-plan actions, and negation keep their established paths.

Before product edits, the mounted client and executable service tests reproduced the failures.
The corrected red test execution failed 98 cases across four suites and passed 43 cases.
It caught automatic client navigation, contaminated journey arguments, failed hours lookup, and an unsupported refusal for a pint comparison.
An earlier red execution remains available. Its intent assertions initially omitted the asynchronous result wrapper and used the wrong mood label.

The independent expectations come from the recorded fix decision and required behaviour.
The mounted client must submit the complete service query instead of navigating.
Journey routing must preserve London Bridge and The Harp in both endpoint orders.
The real journey consumer resolves those names to station and venue coordinates.
The emitted card must identify The Harp as `venue-1bz7oic`.
The hours consumer must read The Harp's fixture record.
Supported pint comparisons must keep their tool, while real unsupported comparisons remain refused.

## Correction and traced paths

The shared request policy separates generic map commands and trailing politeness from service text.
The policy and client map detector share the existing map verb vocabulary.
The parser retains named subjects and the default map-command representation.
The journey matcher and clause splitter recognise destination-first and origin-first directions and routes.
The client no longer interprets a separated generic map clause and remaining service text as a named-pub request.
No acknowledgement list or second service classifier was added.

Both typed and voice callers still retain the original query.
The request policy remains a pure leaf with no new imports.
The protected product callers, Plan payload files, R6 files, caption assertion, tool registry, and tool contracts remain unchanged.
No performance ceiling changed.

## Focused verification

The first verification passed 1,962 tests and failed 38 tests.
Two failures exposed the sibling named-pub dispatch defect for `Take me to the map` beside a service request.
The other failures came from two incorrect new expectations.
The journey consumer sends resolved coordinates, and discovery returns grounded venue actions.
The final tests assert those contracts and retain the service-priority checks.

The final execution passed all 2,004 tests across 11 suites with one worker and no retries.
The suites cover both public handlers, mounted typed dispatch, mounted voice, map resolution, intent parsing, hours, listings, and routing.
Scoped ESLint passed for all nine changed TypeScript files with no warnings.
Focused TypeScript passed with the repository's ambient declarations and the changed files' imports.
The existing isolated locked dependencies passed the repository freshness check.

Logs, configuration, source hashes, dependency hashes, and the complete working delta remain under `artifacts/generic-map-policy-fix/`.
A separate test-evidence copy remains under `/Users/karanmanoharan/.no-mistakes/evidence/01M6KG5SPKPXTN8CB7RNMPRZNJ/generic-map-policy-fix/`.
The original red logs and intermediate verification failures remain unchanged.
The final source manifest identifies the tested working files, not a future child commit.

No build, app server, browser acceptance, live provider, publication, or pipeline-control command ran during this fix.
The mounted tests use external transport and navigation doubles. They do not prove browser destination rendering.
The outer Test phase still owns production acceptance, bundle measurement, and browser acceptance.
