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
Both browser files passed all nine cases against the local production build in 13.8 seconds.
The returning launch reached Home and remained there after hydration.
Onboarding completion, same-origin native onboarding fallback and explicit Tonight parity passed.
Full repository verification and publication checks remain with the release owner.
No current iPhone homepage launch, signed native rebuild, site deployment or production fix is claimed here.
An unchanged binary that loads the current production origin still receives its existing remote launch policy.

## Browser fixture correction

The first browser run passed eight cases and failed the returning native onboarding case.
That case expected Tonight but received the homepage.
The test used `page.goto('/onboarding')`, which starts a browser navigation from outside the page.
The proxy correctly rejects that document request before the native onboarding gate runs.
The old homepage redirect then opened Tonight and concealed this fixture error.

The corrected case uses `window.location.assign('/onboarding')` from its existing `/about` document.
This models the same-origin document navigation admitted by `startedOnThisOrigin` in `proxy.ts`.
The client gate must still send a completed native first run to Tonight without changing stored data.
The test retains those assertions. It changes no product code, request user agent or shared helper.
The proxy does not use the native user-agent token for this decision.
Both corrected browser files then passed against the same completed build.

```sh
PW_SKIP_WEBSERVER=1 PW_SKIP_KEYLESS_WEBSERVER=1 PW_PORT=32197 \
PW_NEXT_DIST_DIR=.next-home-entry-1025 \
node node_modules/@playwright/test/cli.js test \
  e2e/native-shell-tonight-parity.spec.ts e2e/mobile-first-run-onboarding.spec.ts \
  --project=chromium --workers=1 --trace=on
```

The private server used the repository's `webServer.env` from `playwright.config.ts`.
It served the production build for commit `8a1191dc3` with the corrected test fixture.
No product source changed between the completed build and this browser rerun.
