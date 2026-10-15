# Public discovery and planner repairs

Date: 15 October 2026.

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
