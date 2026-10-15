# Public discovery and planner repairs

Date: 15 October 2026.

## Current price-ownership and handoff review

This review starts at `3e4804c2f6b4d3f056505e22a27a852ac0e4c591`. Four preparation regressions reproduced the reported defect before correction. Both query and structured beer-first rates became £5 route totals. Price-first £1 beer rates retained candidates despite the impossible ceiling.

The guard and limit extractor now consume the same pure drink recognition result. Accepted pint, beer, and unspecified drink rates constrain canonical pint evidence. Unsupported servings and selected drink lanes receive an explicit limitation. The focused route regressions cover both amount directions, aliases, clauses, structured fields, conflicting ceilings, meal bundles, selected stops, alternatives, and impossible limits.

`FirstRunOnboarding.startPlan` is the sole production handoff writer. Its default `openPlannerDocument` reads the handoff, constructs the shared-planner URL, clears storage, and opens `/plan`. The named-area additions in `MobilePlanActivation` and `desktopHandoffMoves` therefore add an unused parallel path. This repair removes those two fallbacks and their two new tests. Patch handoffs, named-area persistence, planner URLs, nearby discovery, and coverage fallback behavior retain their existing paths.

Focused verification passed all 1,160 tests across seven files:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts __tests__/onboardingFlow.test.ts __tests__/mobilePlanDrinkDefault.test.tsx __tests__/firstRunOnboarding.test.tsx __tests__/nativeFirstRun.test.ts __tests__/nightPlanning.test.ts __tests__/planRouteReveal.test.ts --reporter=dot
```

The verification checks returned amounts against canonical evidence without converting servings or inventing prices. `git diff --check` found no whitespace errors. No residual issue remains from the two assigned findings within this focused proof.

The [eight browser feedback checks and screenshots](review-feedback/report.md) retain their original source hashes and historical provenance. This review does not rebuild or relabel that evidence. The visible feedback source and browser test remain unchanged. Full verification, Test, Lint, CI, publication, and release acceptance remain with the outer executor.

## Earlier review repair evidence

This review started at `ad32535238a3fba3d6c2b02bb6142547d4c57b69`. The results below cover its uncommitted worktree repairs. They do not establish acceptance of a later commit.

| Finding | Executable reproduction | Repair and focused result |
| --- | --- | --- |
| R1 | Rendered onboarding stored `patch: null` after an accepted Soho fix and lost its area. | The handoff retains the public area name. Web reload and native relaunch simulations preserve it without coordinates. Both map consumers accept named areas. |
| R2 | Reversed budget phrases selected a £5 route total or admitted a £6 candidate. | One parser separates pint rates from route totals. Both phrase orders, standalone rates, and multiple caps retain the correct context and candidates. |
| R3 | Unsupported meal and invalid requests consumed the one-slot deployment budget. | Deterministic preparation refusals precede paid consumption. One-slot regressions prove that the following valid request remains available and the next request receives `DAILY_BUDGET_SPENT`. |
| R4 | Roast, steak, and sandwich prices returned successful pint-only responses. An explicit route budget with pizza was refused. | Query and structured inputs share the correction. Priced meals receive the explicit limitation. Unpriced food preferences with route budgets remain supported. |

Before the source repairs, the focused route and rendered-onboarding command reported 22 failures and 214 passes. Two additional structured fixtures initially exceeded the existing 40-character input limit. Their corrected forms retain the meal and price while omitting redundant location text.

The final focused command passed all 414 tests across six files:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts __tests__/firstRunOnboarding.test.tsx __tests__/onboardingFlow.test.ts __tests__/nightPlanning.test.ts __tests__/nativeFirstRun.test.ts __tests__/mobilePlanDrinkDefault.test.tsx --reporter=dot
```

The fresh browser attempt used this command:

```sh
PW_PORT=3268 PW_SKIP_KEYLESS_WEBSERVER=1 PW_NEXT_DIST_DIR=.next-review PUBMAX_TRACKED_OUTPUTS=public/data node_modules/.bin/playwright test e2e/web-first-run-journey.spec.ts --project=chromium --grep 'carries a located Soho' --workers=1
```

Its pre-repair production build succeeded. Browser launch failed because Playwright's required Chromium headless-shell revision 1248 was absent. The new browser regression did not execute. No browser installation or host search followed. The repaired source has no fresh browser or production-build proof from this phase.

Full repository tests, lint, CI, publication, and final-commit validation belong to the outer executor. Physical devices, authenticated Pub Pal, provider settings, and retention remain unverified here.

All screenshots, browser results, build results, and full-gate counts in the sections below are historical evidence from earlier candidates. They do not validate these review repairs.

## Observed failures and corrections

| Flow | Before | Correction |
| --- | --- | --- |
| Guest Plan | A vegan meal under £10 and 500 calories returned a pub's £6.20 price without meal evidence. | The route generator returns an explicit 422 limitation for meal-price, dietary, or nutrition requests it cannot verify. It does not invent a matching meal. |
| First-run planning | Soho onboarding opened an unrelated six-stop map preview. | Onboarding opens the shared planner with the selected patch, total budget, and a separate per-pint ceiling. Generation either meets those inputs or reports insufficient evidence. |
| Blackfriar Lore | The structured answer repeated both historical facts. | Answer context removes repeated facts across retrieved rows. Citation collection retains every original source reference. |

The £5 Soho browser replay reached the shared planner with three requested stops, a £15 route budget, and a £5 pint ceiling. It reported that no matching three-stop route was available. No unrelated preview appeared. This is an honest shortage result, not proof of three available £5 pints.

## Validation

Regression tests failed before each correction. The public generate route returned 200 for unsupported meal requests before the fix. The duplicate-fact fixture repeated the same statement twice. The initial pint-cap test admitted a £6 candidate under a £5 ceiling.

Independent review found two further cases. Attached units such as `500kcal` needed recognition. A location-based onboarding visit with no price limit still needed its onboarding marker. Both have regression coverage.

- The focused final run passed 207 tests across eight files.
- The two onboarding browser suites passed all 15 tests on the final local production build.
- The production build passed with local asset stamps and a private loopback server.
- An earlier full `npm run verify` passed before the final native-continuity edits. Its coverage phase passed 22,051 tests with one existing skipped test. Its database phases passed 554 and ten tests. Final committed verification remains the delivery gate.

Browser tests used installed Chrome 154 because the repository's expected Playwright browser revision was absent. The temporary configuration changed only the executable and private server location. No browser cache was installed or removed.

The final focused command included `onboardingFlow`, `firstRunOnboarding`, `planGenerateRoute`, `heritage`, `promptBudgetScreenFoot`, `createPasswordPromptRender`, `nativePushPrompt`, and `planComposerRouteResult` tests.

## Native and test continuity

Successful onboarding generation retains the existing high-intent notification event. Phone plan review defers follow-up prompts until another route. Automatic preview generation does not count as a kept plan for store-review prompting.

The push-specific browser cases explicitly start with analytics declined. An unanswered analytics choice can correctly consume the one-prompt budget. These cases therefore establish push eligibility with that prerequisite, not first-session consent acceptance.

The short-phone test previously required a positive scroll offset even when the content fitted. It now checks that offset only when the stage overflows. Its visible controls and next-step reset assertions remain.

## Before and after

| Flow | Production before | Local candidate after |
| --- | --- | --- |
| Meal query | [Before](meal-before.png) | [After](meal-after.png), [snapshot](meal-after.txt) |
| Onboarding | [Before](onboarding-before.png) | [After](onboarding-after.png), [snapshot](onboarding-after.txt) |
| Lore | [Before](lore-before.png) | [After](lore-after.png), [snapshot](lore-after.txt) |

The screenshots show different deployments and data-store conditions. They are behavior evidence, not pixel-difference measurements. The duplicate-input regression supplies the deterministic merge case. The local browser confirms that the rendered structured answer contains the 1875 fact once.

## Limits

This change does not implement nutrition-backed meal planning. Authenticated Pub Pal, ElevenLabs provider behavior, real iPhone and Android devices, formal latency, and retention remain separate acceptance work. Native-shell browser simulation is not physical-device proof.

No production deployment, provider configuration, account data, or public plan changed during this work. The open-source voice assessment is separate research. No speech provider was replaced.


## Follow-up: meal and drink price ownership

A later review found that `One pizza and a pint under £10 in Soho` still returned a £6.20 pint. Reproduction used the published PR source `534d222ca59dc85f3caacd4d5a0fdf597ab7f591` in a local production build. The browser selected one stop and displayed The Lyric without meal evidence. This was a remaining defect, not accepted product behavior.

The follow-up binds each amount before allowing drink-only prices or a pub-route budget. Meal and drink bundles require menu evidence. Explicit pint rates remain supported. A route budget followed by a later food preference remains supported.

| Input | Before status | Corrected local status | Corrected result |
| --- | ---: | ---: | --- |
| One pizza and a pint under £10 in Soho | 200 | 422 | Explicit meal limitation, no stops |
| One pizza in Soho, priced under £10 | 200 | 422 | Explicit meal limitation, no stops |
| 3 pubs in Clapham under £20 per person with pizza afterwards | 422 | 200 | Three pub stops |
| One pub in Soho, with structured food need `One pizza and a pint under £10` | 200 | 422 | Explicit meal limitation, no stops |
| One pub in Soho, with structured food need `pizza in Soho, priced under £10` | 200 | 422 | Explicit meal limitation, no stops |
| 3 pubs in Clapham under £20 per person, with structured food need `£20 per person with pizza afterwards` | 422 | 200 | Three pub stops |

The [before API summary](r5-api-before.json) contains derived statuses and stop counts. The [after API evidence](r5-api-after.json) includes full responses. These requests used an isolated keyless fixture runtime. They do not prove production data availability.

The [before browser snapshot](r5-result-before.txt) records the incorrect £6.20 pint. The [after snapshot](r5-result-after.txt) and [visible limitation](r5-after-limitation.png) record the corrected message. The [before](r5-before.png) and [after](r5-after.png) overview images show the same submitted query. Their top-of-page view does not display the complete result.

The route suite passed 184 tests. The same 15 onboarding browser cases passed on the corrected local production build. An independent subagent checked 46 bounded pricing cases across query and structured food inputs. Those predicate checks supplement the live browser and API evidence. They do not establish full app acceptance.

Full `npm run verify:no-mistakes` passed on the follow-up candidate. Its coverage phase passed 22,162 tests with one existing skipped test. Database phases passed 554 and ten tests. The gate also passed lint, type checking, policy, dead-code, and dependency checks. Three live stores remained unmeasurable without credentials. Existing development-only vulnerability waivers remain in force. These artifacts show the working-tree candidate before publication. They are not evidence of a production deployment or of physical devices.


## Selected review repairs after e83d35f82

The review phase reproduced the five selected findings through executable interfaces before changing product code.
The initial API/parser run reported 34 failures and 221 passes.
The rendered onboarding run reported the Arnos Arms discovery failure and 33 passes.
A test syntax error blocked the first API attempt. The corrected API attempt produced the counts above.

The shared price parser now recognises priced, costing, and for-a-pint clauses in either order with route totals.
It supports pound symbols, decimal commas, pounds, and quid.
The meal guard checks each structured food entry separately, including amounts without a recognised meal noun.
Bare meal budgets require explicit pub, route, or crawl ownership to qualify as route budgets.
The previously accepted structured `pizza and a budget` example now requires explicit route ownership under this selected decision.
Unpriced food preferences, independently priced drinks, and explicit route budgets retain behavioral coverage.

Capped candidate preparation now joins canonical prices before ranking.
It excludes stale, missing, and over-ceiling canonical records from the shared candidate pool used for stops and alternatives.
The regressions use shipped canonical records rather than inventing fresh prices.
Nearby discovery now displays the listed £5.50 Arnos Arms pint outside planner-area discs.
Planning from that location asks for a supported patch before completing onboarding.
The located Soho handoff and coordinate-storage assertions remain covered.

Focused verification command for this review round:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts __tests__/firstRunOnboarding.test.tsx --reporter=dot
```

The final focused run passed 312 tests across both files with no skipped tests.
The first focused run passed 311 tests and exposed a missing history-settlement wait in the new onboarding regression.
That test now uses the existing history-settlement helper before selecting another patch and before checking document navigation.
Product source did not change between those two focused runs.

This round does not run the full test suite, lint, production builds, browser suites, CI, or deployment checks.
Those phases remain with the outer executor. Earlier evidence above does not establish acceptance of this revised source.
