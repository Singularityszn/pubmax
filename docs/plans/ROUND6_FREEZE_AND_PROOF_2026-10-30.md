# Round 6: freeze and proof (week 4 of the launch plan)

Status: BUILDING. Started 30 October 2026 on `claude/launch-week4-proof`, cut from `main` at 734b39e9.

Week 4 of the launch review's four-week proposal (section 5 of `LAUNCH_REVIEW_2026-10-30.md`, on PR 2402 until it merges): no new surfaces, only proof that what shipped in rounds 1 to 5 is fast, honest and operable. Each item below is measured on a production build, dated, and written where the site or the captain reads it. A ceiling comes down, never up.

## 1. What this round proves

| Item | Where it lands | Builder | Status |
| --- | --- | --- | --- |
| Smoke checklist walked in a browser on a local production build, keyless, every row PASS, FAIL or NEEDS KEY with the build SHA | `docs/SOFT_LAUNCH_RUNBOOK.md` section 7 | 34 | landed, e3cd72f2 |
| Ops checklist re-verified and dated | `docs/growth/HORIZON0_OPS_CHECKLIST.md` | 34 | landed, e3cd72f2 |
| The release metric: what to run, what to write down, where; measured on the launch head after merge, never by an agent | `docs/SOFT_LAUNCH_RUNBOOK.md` section 7 | 34 | landed, e3cd72f2 |
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

### Builder 34, smoke walk and checklists (e3cd72f2)

- Eleven smoke results walked in a browser with `npm run e2e:cli` against a keyless local production build of `main` at 734b39e9: 6 PASS, 2 PARTIAL, 0 FAIL, 3 NEEDS KEY. The two partial results are map paint (clustering and a clean console proved; "pins within a few seconds" not proved, because the box draws WebGL in software and painted the first pin after 16 to 18 seconds on cold loads) and the public invite (the three-stop route proved; the one-stop `/map?sel=` branch not walked). The three that need a key are sign-in, handle claim, and the verified-adult Social states; all three need the Supabase URL, publishable key and email sender. The captain proves the two partial results and walks the three key-dependent rows on the production host after the next release.
- The release metric block tells the reader to apply the production and release filters to both the landings and the actions inputs of the tracking plan query, because the query joins the two by distinct id only.
- The ops checklist smoke date is now 30 October 2026. Its old page-title checks matched nothing on production or locally because the titles changed; the checks now read the live titles, checked on both.
- The release metric is not what `scripts/release-production.mjs` measures. It is the first meaningful action within 60 seconds of landing, defined in `docs/analytics/TRACKING_PLAN.md` section 2.1. The runbook block says how to record it from PostHog for the released commit, once the release has had 7 days of traffic.
- Two observations recorded in the runbook, not marked as failures: a Soho plan with no must-have need still answered the 422 line that talks about must-have needs, because the server found one usable pub of 135; production served commit e5da6c0 at the time of the walk, not the current `main`.
- Follow-ups outside this round's brief: `docs/SOFT_LAUNCH_CHECKLIST.md` row 2.8 still uses the old title checks; the ops checklist's "Merge and promote" step 2 still says to merge PR 747, which closed unmerged.
- Store placeholders still open before an app ships: the Apple Team ID in the site association file (two occurrences, and the iOS capabilities test expects the placeholder), the Play signing SHA-256 in the asset links file, the Firebase services file, the Android upload keystore, and the account-side APNs, App Store Connect and Play Console records. Listing copy and screenshots are already in the repo.
