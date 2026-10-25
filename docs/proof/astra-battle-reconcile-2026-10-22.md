# Astra battle-test reconciliation, 22 October 2026

This record separates the pinned Git preview, the local repair candidate, and production.
The supplied `/workspace/battle-2026-10-22/` directory is absent on this host.
Its screenshots, `api-out.json`, `vercel-deploys.txt`, `pr-2309.txt`, and `cut_check.py` were not inspected.
The evidence below comes from fresh read-only captures and repository checks.

## Deployment and data

Both linked Vercel projects report `commandForIgnoringBuildStep: "exit 0"`.
GitHub describes their canceled builds as successful Vercel commit statuses.
The first exact-SHA API preview request also canceled at that step.

The existing dashboard's per-deployment ignore checkbox allowed the pinned Git source to build.
The saved project settings did not change.
Vercel reports the result as `source: redeploy` because the dashboard rebuilt the Git-source deployment.
Its build log records cloning the GitHub repository at the exact requested commit.

| Target | Identity | Result |
| --- | --- | --- |
| Pinned Git-source preview | `325122c23eb9d8bc809c4388448c0e5459146152`, `dpl_6PGiJv7TnnjoYLxpEvtc6Aq7xzaV` | READY, Preview environment. Public version response matches. |
| Production at the start | `542c97545fc00c4c13a5afb5848e8099be0195e0`, `dpl_J72RL2R54gs9amAQ2pkw6EcBRmbu` | Public version response captured. |
| Production during later checks | `e81aaa6a04b720ddb8ef4b909b35ffad445b0088`, `dpl_H8cZfyzhPPUorvaNVF8hiddpwjxn` | Another CLI production build became live during this run. This task did not create or promote it. |

[Open the pinned preview](https://chengdu-2e45hdskb-pubmax69.vercel.app/map).
[Read its version response](https://chengdu-2e45hdskb-pubmax69.vercel.app/api/version).

The deployed slim index contains 2,250 rows and matches the pinned commit exactly.
The comparison with `542c975` preserves all 939 priced pub rows and their prices.
The pint-price dataset is byte-identical between those commits.
The withholding audit names 18 entries.
Thirteen entries actually leave the slim index: ten bars, two food venues, and one restaurant.
Lahore Kebab House enters the index.
These removals include cocktail and food prices, so this finding does not claim that every priced venue remains.
The priced pub records remain unchanged.
Hatton retains its ID, and its public contribution GET returns the visible £4.70 pint.
That figure is a contribution, not a baseline price in the slim bundle.

## Repairs

| Finding | Behaviour after the repair |
| --- | --- |
| Restored query loses price pins | A query narrows the result list and camera. Surrounding pins retain their prices and all other filters. |
| City suggestion on London query arrival | Explicit map intent suppresses the generic suggestion. |
| Closed sheet reopens on reload | A query-only URL restores camera framing. Explicit `sel` restores a sheet. Typed single-result selection retains its existing behaviour. |
| Hatton search junk | Matching no longer accepts arbitrary subsequences across full names and areas. Place matching starts at a word boundary. Legitimate spacing and single-missing-letter name matches remain. |
| Tonight contradicts its music | The empty primary list acknowledges sourced music below. Credits count displayed secondary music with its own evidence date. |
| Desktop hides Live music | The existing music section is visible at desktop and phone widths. Its desktop cards fill the narrow rail. |
| Loading picks remains visible | The section omits its empty editorial placeholder until it has data. |
| Incorrect BarOrPub types | The canonical Ledger schema remains for pubs and bars. Restaurant and food records no longer receive that type. |

Hatton's address appeared correctly from first appearance in the pinned preview at desktop and 390 by 844.
A delayed detail response did not reproduce the lowercase flash.
The Google Places disclosure says 4 October and matches its stored observation timestamp.
The repair preserves those source dates.

## Browser evidence

The restored-map regression reproduced the original failure before the repair.
The strengthened regression also reproduced the sheet reopening on a query-only reload.
The local repair build in production mode passed at desktop and phone widths.
Screenshots show painted pound labels with the explicit Hatton sheet open, after Close, and after Reload.
After Close and Reload, the URL retains `q=Hatton` without `sel`, and the sheet stays closed.

The Hatton search capture preserves Hatton at both widths and excludes every reported false match, including Long Whatton.

The pinned preview supplied no music row during the fresh feed check.
The current production feed did contain REALLY GOOD TIME at The Lexington, from Ticketmaster.
The source capture's version response matched `e81aaa6a` before and after the GETs.
The browser replay used those exact response bytes on the local repair build. It changed no event or date.
At both widths, the music section appeared and the heading, source credits, and event card agreed.
This is recorded-production-feed replay evidence, not proof that the repaired code is hosted.
The final browser spec also uses a deterministic external-feed fixture for this behaviour.

Live and hosted browser checks blocked every request except GET and HEAD.
Local write-free captures also blocked service workers where the replay required deterministic request interception.

## Approval and remaining gaps

The [approved manual daily build plan](astra-daily-build-proposal-2026-10-22.md) owns the build slot, target, retry, and promotion rules.
The approval creates no saved schedule or project setting.

The physical-phone map picture remains pending at Karan's explicit request.
Signed-in Confirm remains untested because no safe active isolated verification database was established.
The available test project reports INACTIVE.
A preview URL alone does not establish database isolation.
No production write or verification account was created.

The external cut-check script remains unavailable.
No scoring replacement, timestamp refresh, workflow change, environment change, billing change, migration, merge, or production promotion is included.

The first full run found nine root-shell import failures.
The city prompt reached rendering and venue modules through the URL-intent helper.
The predicates now share a lightweight URL-only module with their existing public exports.
The unchanged root-shell fence passes all 21 cases after this correction.
A second full run overlapped Playwright output cleanup with two CLI fixture suites.
Both fixtures stored files under Playwright's default `test-results` directory.
The verification setup now uses a separate browser output directory and runs the full check without concurrent browser tests.
Both affected fixture suites pass their isolated recheck, covering 80 tests.

The retained local evidence is under `artifacts/astra-battle-1022/` and the contributing worktrees' dated artifact folders.
The local review page is `.lavish/astra-battle-1022/index.html`.
Final verification results are recorded by the integration owner after the checks finish.

## Final local verification

The clean `npm run verify` run passed with the documented process-only committed-data settings.
It ran 42,531 unit tests, 680 PostgreSQL tests, and ten serial PostgreSQL tests successfully.
One unit case remained skipped under the repository's existing conditions.
Lint, generated database types, TypeScript, the ChatGPT map tests, dead-code checks, coverage thresholds, browser skip gates, and dependency policy passed.
The audit reported no unwaived high or critical vulnerability.
The freshness check passed with two advisory stale datasets and three durable feeds that this keyless runtime cannot measure.
Those feeds are not reported fresh.

The initial product-source build was `c32a3ad3b2b52eb08b4e189bf9bb33936f65239e`.
Its production build passed, and all four desktop and phone browser regressions passed.
The restored-map, Tonight consistency, and full-width music-card checks ran against that build.
The local import-graph recheck passed 53 tests across three files.
Both CLI fixture suites passed all 80 tests after separating browser output.

The publication gate still owns rebase, review, push, the pull request, and hosted CI.
No publication-gate or hosted-CI pass is implied by these local results.


## Published preview and review follow-up

Karan approved one additional Git-source Preview build for PR #2321 at `3ec0047ec5dc03342da701cc6579cd3e97ad82ba`.
That build is READY at https://chengdu-alz6ewg8e-pubmax69.vercel.app.
Its public version response reports the exact SHA and `dpl_E4TyJkCSyGkCeMSggaK1NNoYGQf8`.
The saved ignore command remains unchanged.

Fresh hosted checks passed at 1440 by 1000 and 390 by 844.
They cover Hatton selection, Close, query-only Reload, surrounding price pins, city-prompt suppression, and search suggestions.
All 939 priced pubs retain their prices, and Hatton's public contribution remains £4.70.
The hosted feeds now contain no music, and both Tonight views agree with those responses.
This hosted check does not prove a populated music section.
The separate recorded-feed checks prove that state on the local repair build.

The external review then found a real Near me regression.
The surrounding-pin repair left remote query matches outside the held local membership.
A typed Richmond query therefore kept the camera at the emulated Trafalgar Square location.
Reloading the same query without that membership framed Richmond.
The follow-up releases Near me membership when typed search takes camera ownership, preserving the other filters.
The later review correction also releases that membership when a venue is selected through either search-suggestion path.
Explicit selections retain camera ownership, so the deferred typed search cannot replace them.
The expanded regression covers contextual price pins after Close and query-only Reload for both suggestion paths.
It also updates obsolete Tonight expectations for matched music, source credit, and separate Deals and Music sections.
These later corrections are not covered by the `db8d344` result below. The outer validation phase owns their results.
The phone regression also waits for the shared mobile map shell after navigation and reload.

The combined production build at `db8d344045b9aefd1a618922ef76881e87959279` passed.
All five map and Tonight browser regressions passed on that build, including Near me followed by the remote query.
The focused worker checks also passed 75 tests, lint, and TypeScript.
The published `3ec0047` preview does not contain this later follow-up.
Remote suggestions whose map shards are not loaded remain a separate existing limitation.
The published-head CI and the follow-up publication gate still require their own recorded outcomes.
