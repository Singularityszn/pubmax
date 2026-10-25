# Native homepage entry, 25 October 2026

The owner requested the public homepage on a normal returning app launch.
This patch replaces the native Tonight launch rule for iOS and Android.
The installed iPhone still receives the existing production launch rule.

## Changed behavior

- A returning native launch at `/` keeps the homepage.
- A returning native launch through `/app-entry` opens `/` and stays there.
- A new or unfinished native first run still opens onboarding.
- Explicit destinations and root auth callbacks retain their existing handling.
- Installed PWAs retain Tonight as their launch destination.
- Onboarding completion and direct returning onboarding keep their existing Tonight destination.
- Launches preserve stored cities and first-run completion state.

The change uses `lib/entryDecision.ts` and `public/theme-init.js`.
It adds no native setting, URL exception, injected session state or homepage alias.
The existing launch script records its normal session stamp before opening the homepage.

## Red and green evidence

The baseline commit is `0bb6fa2e4c0c04ac26db4a1b95305f2d47fb0559`.
The tests ran against the working source before any commit.
The commands returned their output inline. These files preserve relevant excerpts as tool-output transcripts:

- [Decision failure](red-decision.txt).
- [Pre-paint failure](red-prepaint.txt).
- [Focused passing run](green-focused.txt).

1. The decision test first expected `stay` with reason `native-home`.
   It failed because the baseline returned `/tonight` with reason `shell-cold-start`.
   The one-test rerun passed after the decision changed.
2. The pre-paint test first expected `/` from a returning `/app-entry` launch.
   It failed because the baseline opened `/tonight`.
   The script now opens `/`, and the entry tests pass.
3. The final focused run passed 11 files and 214 tests in 5.97 seconds.
   It covers launch decisions, the pre-paint chain, callback preservation, first-run state, city validation, explicit links and onboarding completion.

The final focused command was:

```sh
node node_modules/vitest/vitest.mjs run --configLoader runner \
	__tests__/entryDecision.test.ts __tests__/nativeShellEntry.test.ts \
	__tests__/nativeEntryCallback.test.tsx __tests__/nativeWrap.test.ts \
	__tests__/nativeFirstRun.test.ts __tests__/landingPrimaryDoor.test.tsx \
	__tests__/cityPreference.test.ts __tests__/nativeDeepLinks.test.ts \
	__tests__/onboardingFlow.test.ts __tests__/offlineReadyRegistration.test.tsx \
	__tests__/accountSurfaceStoreDoors.test.tsx
```

The jsdom run printed three existing `Window.scrollTo` messages. No assertion failed.
`git diff --check` passed.
Playwright listed nine cases across the two affected browser files.
Listing proves that the specs load. It does not prove browser behavior.

## Remaining release evidence

The two browser contracts now expect Home on a normal returning launch.
They retain explicit Tonight composition and worker-cache checks.
Their browser execution, full repository verification and publication checks remain with the release owner.
No current iPhone homepage launch, signed native rebuild, site deployment or production fix is claimed here.
An unchanged binary that loads the current production origin still receives its existing remote launch policy.
