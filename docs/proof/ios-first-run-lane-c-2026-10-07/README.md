# First-run layout and relaunch proof

This record covers iOS QA findings F02 and F23. Both builds used production Next.js assets in this worktree.
Chrome ran at 375x667 (iPhone SE) and 402x874 (iPhone 17 Pro), in light and dark themes.
The approved Playwright fallback used the repository's native shell stub and a denied location response.
These screenshots prove browser layout and native routing policy. They do not prove a physical iPhone or WKWebView safe-area rendering.

| Before | After | Why |
| --- | --- | --- |
| SE Use London occupied y=725-775, below its 667 px viewport. | Every SE primary occupies y=605-655 in all five steps. | One footer stays below the scrollable question area. |
| SE Continue occupied y=638-688 and was clipped. | Continue uses the same 50 px action target as every other primary. | The photograph yields on short screens. |
| Action rows moved between steps. | Pro primaries occupy y=812-862 in every step. | One shared action bar owns all primary and Back controls. |
| A relaunch at location opened Tonight. | Location and companion steps resume with the saved budget and Pal. | Only Skip or Plan my night records native completion. |

The action bar includes `calc(12px + env(safe-area-inset-bottom, 0px))` bottom padding.
The scrollable stage cannot cover its footer. Button centres remain tappable after scrolling to the end.
Every measured primary is 50 px high. All four device/theme combinations have zero horizontal overflow.

The eight browser checks cover all five steps, all four budgets, every Pal choice, denied location, patch selection,
Back, Change budget, Change area, result relaunch, companion relaunch, Plan my night and Skip.
A result relaunch returns to location because its price read is temporary. Location coordinates remain unpersisted.
Skip and Plan my night clear unfinished progress. Later launches open Tonight.

The before captures predate image decode. They prove the button geometry, not photograph loading performance.
The after captures wait for the photograph or Pal image to decode.

The JSON files contain measured rectangles. The screenshot folders contain matching device/theme names.
For example, compare [SE light before](before/se-light-london.png) with [SE light after](after/se-light-london.png).
Compare [Pro dark relaunch before](before/17pro-dark-relaunch.png) with
[Pro dark relaunch after](after/17pro-dark-relaunch-location.png).

Validation results:

- The five focused unit suites passed all 84 tests.
- The production device/theme matrix passed all eight checks.
- The final production build completed with exit code 0.
- Thirteen existing onboarding journeys passed, including the short-screen scroller regression and light/dark layout checks.
- `npm run verify:no-mistakes` completed with exit code 0 after Full Disk Access was restored.
  Its unit run passed 21,002 tests with one existing skip. PostgreSQL checks passed 564 tests.
  Data validation, lint, schema types, TypeScript, ChatGPT map checks, Knip, skip checks, freshness and audit passed.
  Three durable feeds remain unmeasurable without credentials. The freshness check does not report them fresh.

Two existing native push journeys still fail at the expected `Know when tonight changes` dialog on Tonight:

- `native first run hands one useful Plan to the contextual push ask`.
- `Skip releases onboarding budget for the next Plan but never prompts on reboot`.

Both fail identically on a production build of `origin/main` at `3bc62e232be88dcbfa564ecb01970aba68afa9de`.
The comparison used the same installed Chrome, port, native shell stub and keyless server settings.
Both journeys reach Tonight before the shared assertion at `e2e/mobile-first-run-onboarding.spec.ts:57` times out.
See the [baseline output](push-main.txt), [Lane C Plan output](push-plan-lane-c.txt) and [Lane C Skip output](push-skip-lane-c.txt).
This evidence establishes a baseline failure. It does not establish that the native push journeys pass.

Earlier verification attempts failed after concurrent Playwright output cleanup removed unit fixtures,
then at a shared Git `info/exclude` permission error. Browser output now has a separate artifacts directory.
The final verification retry passed after the permission repair. Tracked datasets remained unchanged.
