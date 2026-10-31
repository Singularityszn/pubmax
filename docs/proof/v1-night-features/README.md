# V1 night feature implementation evidence

The implementation extends the existing Plan with route comparisons, private table signs, sourced clues, and optional mystery reveals.
The source baseline is `059905ea55d8d173535733721fc6e729460a9f35`.
GitHub still reported that main commit at the final source check on 31 October 2026.

## Source and database checks

- The integrated fixture-based run passed 440 tests in 36 files.
- The run includes 22 local PostgreSQL checks across migrations 0213, 0214, and 0215.
- After the final small changes, the affected clue, presentation, and migration tests passed another ten checks.
- The table-sign UI tests passed seven checks after enabling the React test environment flag.
- The native TypeScript compiler passed with `--noEmit --incremental false`.
- ESLint passed for all 45 changed source files with zero warnings.
- Database types came from the repository generator and a throwaway PostgreSQL cluster.
- The unused-code gate passed after removing two unnecessary exports and relocating the temporary unit configuration.
- The browser test skip scan passed across 385 spec files.

The isolated test configuration inherits `vitest.config.mts`, retains `vitest.setup.ts`, and sets `globalSetup: []` and `maxWorkers: 1`.
This excludes the automatic data builder for the controlled fixtures. It does not replace the normal verification gate.
One worker ran the initial unit bootstrap before its data-builder dependency was identified. Further builder runs then stopped.

## Review findings and corrections

The specification review found that completed stops could become sealed again after a route revision.
Stamped arrival actions now remain revealed across revisions because route writes preserve the completed prefix.
Unstamped historical actions do not establish a reveal or a current table sign.

The standards review found a removal race in grounded proposal creation.
Proposal creation, voting, and decisions now check the current member token inside the database transaction.
Local PostgreSQL tests reproduced revoked-member and rotated-token failures before the correction.
Both reviewers confirmed their findings were closed in source.

Additional tests cover request deadlines, stale responses, account changes, shared reveal state, expiry, and keyboard focus on the table sign.

## Interfaces and rollout

- `GET/PUT/DELETE /api/plans/[id]/beacon` uses a live Plan member capability. Only the host changes the sign.
- `GET/PUT /api/plans/[id]/presentation` uses the same private membership boundary. Only the host changes the mystery setting.
- Sliding Doors uses the existing proposal and vote routes. The saved route changes only after host acceptance.
- Clues use public venue and walking-route reads after an explicit request. Straight-line fallbacks supply no clues.

Migrations 0213, 0214, and 0215 include rollback files. No live database received these migrations.
Table-sign reads stop at expiry. A later access removes a clock-expired note. Route and action changes remove it transactionally.
The full Plan holds comparisons and detailed evidence. Night mode keeps table signs, clues, reveals, and a visible full-Plan exit.

## Remaining acceptance

The application build, normal full verification, and browser execution require the pending explicit build approval.
`e2e/v1-night-extras.spec.ts` contains desktop and phone coverage but was not executed.
No physical-device acceptance, PR publication, merge, or deployment occurred.
The existing release and native ownership records remain in force.
