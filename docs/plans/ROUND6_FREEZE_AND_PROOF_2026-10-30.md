# Round 6: freeze and proof (week 4 of the launch plan)

Status: BUILDING. Started 30 October 2026 on `claude/launch-week4-proof`, cut from `main` at 734b39e9.

Week 4 of the launch review's four-week proposal (section 5 of `LAUNCH_REVIEW_2026-10-30.md`, on PR 2402 until it merges): no new surfaces, only proof that what shipped in rounds 1 to 5 is fast, honest and operable. Each item below is measured on a production build, dated, and written where the site or the captain reads it. A ceiling comes down, never up.

## 1. What this round proves

| Item | Where it lands | Builder | Status |
| --- | --- | --- | --- |
| Smoke checklist walked in a browser on a local production build, keyless, every row PASS, FAIL or NEEDS KEY with the build SHA | `docs/SOFT_LAUNCH_RUNBOOK.md` section 7 | 34 | building |
| Ops checklist re-verified and dated | `docs/growth/HORIZON0_OPS_CHECKLIST.md` | 34 | building |
| The release metric: what to run, what to write down, where; measured on the launch head after merge, never by an agent | `docs/SOFT_LAUNCH_RUNBOOK.md` section 7 | 34 | building |
| Route, API and Core Web Vitals sweeps on `main`, three samples after one warm-up, ceilings follow the figures down, breaches held and named | `perf/route-budgets.json`, `perf/api-budgets.json`, `perf/cwv-baseline.json`, the dated findings entry | 35 | building |
| The three round 5 routes measured instead of seeded (`/time-machine`, `/board/[venueId]`, `/dog-of-the-week`) | `perf/route-budgets.json` on PR 2412 | 32 | building |
| Browser specs for the six round 5 surfaces, keyless | `e2e/` on PR 2412 | 33 | building |

Round 6a (builders 32 and 33) lands on PR 2412 because it proves round 5's own routes. Round 6b (builders 34 and 35) lands here because it proves `main`.

## 2. What this round does not do

- No deploy, no release, no Vercel change. The captain decides a deploy and records the release metric.
- No migration. Migrations 0203 to 0211 (PR 2402) and 0212 (PR 2412) wait for the captain.
- No product code. A defect found by the smoke walk or a sweep is a finding in the table, fixed in its own PR.
- No pint refresh run. The refresh cadence is captain decision 6 in the launch review; this round only makes sure the date the site prints is the date the data carries.
- No new feature from the week 3 leftovers (roulette, the dry round, quiz teams). They wait behind captain decision D2.

## 3. The sweep that is still owed

Every figure in this round is measured on `main` or on PR 2412's head. The launch head is `main` after PRs 2402 and 2412 merge, and it must be swept again before the public build: route budgets, API budgets, Core Web Vitals, and the smoke walk. That re-run is the last item of week 4 and it cannot start before the merges.

## 4. What the captain must do

- Read the smoke table in the runbook when builder 34 lands it, and decide each FAIL: fix before launch, or accept with a note.
- Decide the four launch-review questions that gate copy and flows: the public London lane on Social (D2), the age assurance route, the receipt rule, and whether Clerk stays.
- After PRs 2402 and 2412 merge, say so, and the launch-head sweep runs.
- Record the release metric on the launch head, following the runbook block.

## 5. Record

Filled in as the builders land.
