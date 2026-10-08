# Native push ask lifecycle proof

The isolated branch started at `d69cd6083e8d81d57d56075e35a431efb804a026`, equal to `origin/main` on 8 October.
The worker fast-forwarded the clean checkout before recording this base.

The worker read the [lane C report](../ios-first-run-lane-c-2026-10-07/README.md) and merged
[onboarding change](https://github.com/Singularityszn/pubmax/pull/2060) before reproduction.
They record two historical failures, followed by passes without a diagnosed push fix.

## Diagnosis

The two exact reported journeys pass on the fresh production baseline. See [baseline.txt](baseline.txt).
They also pass in both themes without a pre-dismissed map arrival card. See [cold.txt](cold.txt).
The direct Plan handoff suppresses that card through its `plan=1` parameter.
These results do not establish the cause of the 7 October failures.

A real navigation sequence reproduces the same missing dialog after either onboarding completion or Skip:

1. Make a useful three-stop Plan and close the planner.
2. Open Places, where the push explainer appears.
3. Open the clean Map route and wait for its first-visit card.
4. Open Tonight, without a document reload.

Tonight renders before the previous map card's effect cleanup releases its prompt gate.
`NativePushPrompt` subscribed to useful-action changes, but only read the prompt budget during render.
The later gate release did not notify that subscription. The eligible explainer stayed hidden on Tonight.
The regression checks an unchanged `performance.timeOrigin`, so a cold boot cannot explain the missing ask.
All four production cases failed at the dialog assertion. See [browser-regression-red.txt](browser-regression-red.txt).
The matching render regression failed at the same missing dialog. See [unit-red.txt](unit-red.txt).

The fix subscribes the component to the existing prompt-budget store.
It adds no durable action marker and changes no permission or registration policy.
An undecided consent choice and a spent analytics session claim still block the ask.
"Not now" stays dismissed until another useful action. The phone Map still owns its screen foot.
A fresh document cannot revive the stored action sequence.

## Evidence limits

This proof uses production Next.js assets, installed Chrome 154, and the repository's iOS Capacitor bridge fixture.
The viewport is 390x844. The captures cover both themes and both onboarding finish choices.
The server uses keyless settings. The existing Plan API response fixture supplies the useful route.
No credentials, push registration, production writes, provider calls, or simulator devices are needed for this reactive-state defect.
This proves browser fixture behavior. It does not prove an iOS runtime, APNs registration, or delivery.
TypeSafe environment credentials were absent. No semantic adviser call was needed for the deterministic regression.

The production server uses private port 3417 and `.next-ios-push`.
Each browser run has a separate output directory under `artifacts/ios-push-ask-2026-10-08/`.
Historical logs, setup failures, traces, and the first reproduction are preserved at
`.tmp-evidence/ios-push-ask-2026-10-08-preserved/browser-and-validation/`.
A restore manifest records the original paths.
Committed text logs remove trailing whitespace. The local archive retains the original output.
Lint scanned the temporary browser files and an older generated `ios/build/voice-before` directory.
Those files moved into the existing ignored evidence directory without content changes.
The older iOS build remains under `ios-voice-before/`, beside the manifest.
Builds and full verification run sequentially.

## Validation

The focused suites pass 106 tests, including consent priority, dismissal, native permissions, onboarding, and the new render regression.
See [unit-green.txt](unit-green.txt).

The fresh production build passes all ten browser journeys. See [browser-green.txt](browser-green.txt).
The four additional phone captures pass full-card visibility, both 44px action floors, centre hit tests, and zero horizontal overflow.
See [phone-proof.txt](phone-proof.txt). The native reboot checks show no explainer in a fresh document.

The full `npm run verify:no-mistakes` gate exits zero. See [full-verify.txt](full-verify.txt).
Coverage passes 21,424 tests with one existing skip. Database checks pass 554 tests.
The skip-policy suite passes ten tests. Lint, database types, TypeScript, dead code, freshness, and dependency audit also pass.
The freshness check reports three unmeasured store feeds, without claiming they are fresh.

## Phone comparisons

Each pair shows the same natural navigation sequence at 390x844.
The missing explainer becomes a visible, tappable card above the existing tab bar.

| Finish and theme | Before | After |
| --- | --- | --- |
| Plan, light | [Missing ask](before/plan-light-tonight.png) | [Visible ask](after/plan-light-tonight.png) |
| Plan, dark | [Missing ask](before/plan-dark-tonight.png) | [Visible ask](after/plan-dark-tonight.png) |
| Skip, light | [Missing ask](before/skip-light-tonight.png) | [Visible ask](after/skip-light-tonight.png) |
| Skip, dark | [Missing ask](before/skip-dark-tonight.png) | [Visible ask](after/skip-dark-tonight.png) |
