# Onboarding browser fixture clock

This record addresses only `onboarding-browser-success-depends-on-price-expiry`.
The starting HEAD is `2122760f1f2c1413b9b98fe94d1218a768c9550e`.

The finding was legitimate. The bounded onboarding test required fresh canonical prices while its server used ambient time.
The original browser case failed at its inferred-context assertion with server `Date.now()` set to `2027-10-15T12:00:00.000Z`.
The real future-date endpoint returned `422 GROUNDED_CONSTRAINTS_UNSATISFIED`.
This was a test isolation defect. Production freshness filtering was correct.

The invariant is that a browser case requiring canonical-price success uses the dataset fixture clock for its real generation request.
Within this changed area, the invariant applies to the located onboarding POST and its area, budget, pint ceiling, origin, and storage assertions.
The two patch-selection cases assert handoff links rather than successful generation. The other seven cases do not require canonical-price generation success.

The bounded case now starts a private production Next server on an operating-system-assigned loopback port.
Only that child process pins `Date.now()` to `PINT_DATASET_OBSERVED_AT + 1,000 ms`, matching the existing unit fixture clock.
The browser follows the landing, onboarding, geolocation, and planner journey against that server.
The request reaches the real generation HTTP route. No generation response is mocked.
The fixture preserves the harness browser state at its private origin and stops its server in `finally`.

`E2E_SERVER_ENV` now names the existing primary server environment once in `playwright.config.ts`.
The normal server and the fixture both use that declaration.
This also supports deliberate build reuse with `PW_SKIP_WEBSERVER=1`.
The fixture clears the narration provider key. No provider configuration or dependency version changed.

All existing handoff, origin, area, total 1800p, and coordinate non-persistence assertions remain.
Additional assertions require HTTP 200, a satisfied 1800p budget, three stops, and selected pint prices between 1p and 600p.
Before verification, tracing covered server startup, readiness, browser state, the successful POST, the stale-price refusal, and cleanup.
No application branch, helper, or caller became unreachable.

## Focused verification

The commands used the installed Chrome channel, one worker, an isolated `.next-onboarding-clock` build, and zero browser retries.
The original reproduction built through `scripts/run-with-restored-next-env.mjs`, with `PUBMAX_TRACKED_OUTPUTS=public/data`.
Subsequent checks reused that completed build because application source and data did not change.

| Check | Result | Raw evidence |
| --- | --- | --- |
| Original browser case, future server date | One failure at the reported assertion | [Red](onboarding-clock-before.txt) |
| Complete affected browser file, normal server date | 10 passed, 0 skipped, 0 retries | [Normal](onboarding-clock-after-normal.txt) |
| Complete affected browser file, future server date | 10 passed, 0 skipped, 0 retries | [Future](onboarding-clock-after-future.txt) |
| Real ambient endpoint, normal date |HTTP 200 | [Response](onboarding-clock-ambient-normal.json) |
| Real ambient endpoint, future date |HTTP 422, canonical scarcity | [Response](onboarding-clock-ambient-future.json) |
| Bounded browser case with `PW_SKIP_WEBSERVER=1` | One pass, 0 retries | [Build reuse](onboarding-clock-reuse.txt) |
| `__tests__/playwrightProjects.test.ts` | Three passes | [Harness tests](onboarding-clock-config-tests.txt) |
| ESLint on the spec, fixture server, and Playwright config | Exit 0, no diagnostics | [Lint](onboarding-clock-lint.txt) |

The [harness archive](onboarding-clock-harness.json) contains the exact temporary inputs and commands used for reproduction and final verification.
The temporary files were removed after verification so they cannot enter repository-wide type or lint checks.
The temporary configs select installed Chrome without changing the repository's browser defaults.
The normal config starts the existing build with `next start`.
The future config preloads a test-only `Date.now()` override into that ambient server.
A direct POST to each ambient server confirms that normal evidence succeeds and expired evidence still refuses.
The bounded browser case uses its separate fixture-clock server under both ambient dates.
The reuse config disables the ordinary server and exercises the bounded case through its owned fixture server.

An initial lint check identified React's hook rule interpreting Playwright's callback name `use` as a React hook.
The callback was renamed to `provide`. No rule or threshold changed.
The raw lint failure is [retained](onboarding-clock-lint-before.txt).
The final browser, harness, reuse, and lint checks ran after all corrections.

The [source manifest](onboarding-clock-source-evidence.json) records source hashes, build ID, browser version, test statistics, fixture times, and closed ports.
Application source, committed data, freshness thresholds, and production clocks remain identical to the starting HEAD.

## Limits and handoff

This is test-only evidence for the affected onboarding file and its harness configuration.
The controlled server clock is scoped to `Date.now()`, as in the existing canonical unit tests.
It does not freeze browser time, timers, or operating-system time.
These checks do not establish authenticated, provider, native-device, retention, or full product acceptance.
The historical 40-browser and 16-HTTP package is not relabelled as current evidence.
The outer executor owns the fresh complete Review, full configured Test, commit, publication, and CI phases.
This review agent did not invoke or control those phases.
