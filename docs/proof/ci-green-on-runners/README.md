# Green on the Avrea runners

GitHub-hosted allocation answered nothing between 5 September 2026 11:08Z and
6 September 16:37Z, so no workflow ran for a day and a half. The captain
installed Avrea runners and PR #1585 moved all sixteen `runs-on` lines to
`avrea-ubuntu-latest-2-vcpu`. Its run 34046044501 was the first CI since the
blackout: ten jobs passed and two failed. The Browser tests run beside it
(34046044434) failed on one more.

Four faults, four fixes. None of them is a runner fault, and each reproduces on
a developer machine. No gate is loosened and no ceiling moves.

## 1. Production build refused a keyless build

    Error: [storeBackend] durable store required in production; refusing process-memory fallback
        at e (lib/storeBackend.ts:36:11)
        at $ (lib/weatherSnapshotStore.ts:177:10)
        at ae (lib/weatherFreshness.server.ts:187:31)
        at bt (app/today/page.tsx:121:5)
    Export encountered an error on /today/page: /today, exiting the build.

`next build` sets `NODE_ENV=production`, so a machine with no Supabase keys
satisfies `isDeployedProduction()` while Next prerenders `/today`, which reads
the weather snapshot store. `selectStore` (#1569) then refuses. A build serves no
request, so nothing it writes can be lost.

Reproduced locally on 6 September before the fix, on a checkout with no
`.env.local`:

    $ NEXT_DIST_DIR=.next-prod npm run build
    ... same error, exit=1

So `npm run build` was broken on every keyless machine, not only on CI.

`isProductionBuildPhase()` (`lib/deploymentEnv.ts`) is the one leaf both guards
read. `lib/serverEnv.ts` already skipped its startup assertions on exactly this
signal; `requiresSupabaseStore()` now reads it too. After the fix:

    $ NEXT_DIST_DIR=.next-prod npm run build
    exit=0

The runtime guarantee is unchanged, because Next never sets that phase on a
server answering a request. `__tests__/storeBackend.test.ts` proves both halves,
and the new case fails when the one line is removed:

    FAIL  __tests__/storeBackend.test.ts > storeBackend > selectStore takes the
    memory backend while `next build` prerenders
    Error: [storeBackend] durable store required in production; refusing process-memory fallback

## 2. The budget ratchet could not fetch its base

    fatal: could not read Username for 'https://github.com': No such device or address

Every checkout in `ci.yml` sets `persist-credentials: false`, so the step's
`git fetch` had no credential. The checkout is already `fetch-depth: 0`, which
brings every branch down as a remote-tracking ref, so the base is on disk.

The step verifies the ref before it runs, because the ratchet reports a base it
cannot read as a check that did not run and exits 0:

    $ node scripts/check-budget-ratchet.mjs origin/does-not-exist
    [budget-ratchet] could not read perf/route-budgets.json at origin/does-not-exist, so nothing was compared.
    exit=0
    $ git rev-parse --verify refs/remotes/origin/does-not-exist
    fatal: Needed a single revision
    rev-parse-exit=128

    $ node scripts/check-budget-ratchet.mjs origin/main
    [budget-ratchet] no ceiling was raised against origin/main.
    exit=0

A missing ref now fails the step instead of turning the pawl off in silence.

## 3. A law pin clicked a button the product no longer paints

    e2e/smoke.spec.ts:344 mobile venue sheet sticky actions switch to Train and price sign-in gate
    Error: locator.click: Test timeout of 120000ms exceeded.
      - waiting for ... getByRole('toolbar', { name: 'Venue actions' })
        .getByRole('button', { name: /add a price/i })

Not runner slowness: it reproduces on this Mac in the same 120 s.

PR #1517 folded the sticky strip's `Add price` into the Overview's one price door
on 5 September at 13:56, an hour and a half after the blackout began, so the
spec has not run since the law changed. `components/map/inspector/VenueStickyBar.tsx`
says so in its own comment, and a probe of the rendered sheet at 390 confirms it:

    PROBE_DOORS   [{"kind":"log","label":"Log tonight's price at Arnos Arms","text":"Log tonight's price"}]
    PROBE_TOOLBAR ["Make it Stop 1","Share"]

The pin now says what the law says: no price action in the strip, exactly one
door on the Overview, and taking it anonymously still lands on the sign-in gate.
120 s timeout before, 12.4 s pass after.

## 4. A dropped tap, and a gate that fails on a retry

`e2e/surface-back-and-home.spec.ts:77` was flaky on the runner: `Plan an outing`
is painted on the server and is tappable before React attaches, so the lone click
was dropped and the sheet stayed on `layers`. `scripts/assert-playwright-gate.mjs`
fails on any retry, so a flake is a red job. The click is retried now, which is
the idiom AGENTS.md already names.

Behind it sat a fault nothing had ever run into: the gate step landed on
6 September at 01:06 (#1572), inside the blackout, and it refuses every skip,
including the one `e2e/plan-capability-recovery.spec.ts` argues in
`e2e/conditional-skips.allowlist.json` (no service-role key in the keyless
server, #1300). The run gate now reads that same argued list, and an unargued
skip still fails:

    $ node scripts/assert-playwright-gate.mjs playwright-law-pins.json --require-zero-skipped
    playwright gate failed: 1 skipped test(s): plan-capability-recovery.spec.ts > ...
    $ node scripts/assert-playwright-gate.mjs playwright-law-pins.json --require-zero-skipped \
        --skips-argued e2e/conditional-skips.allowlist.json
    {"discovered":91,"skipped":0,"arguedSkips":1,"unexpected":0,"retried":0,"axeSeriousOrCritical":0}

The whole law-pin set, run locally against a production build on a private port:

    90 passed, 1 argued skip, 0 retries (7.3m)

## What the audit found and did not fix

- `rls-session.yml` downloads `postgrest-v14.16-linux-static-x86-64` and installs
  the `postgresql-16` apt package. Both assume an x86-64 Ubuntu host with `sudo`.
  The job passed on Avrea (run 34046044534), so the assumption holds today; an
  arm64 runner would break both lines.
- `npx playwright install --with-deps chromium` needs the same `sudo`. It worked
  in three jobs on Avrea.
- No workflow uses `docker`, a service container, `/dev/shm` sizing or `ipcs`.
- `api-performance.yml` fires only on a production `deployment_status`, so it
  cannot be exercised from a pull request. It runs Node and one probe script and
  carries no runner-specific step.

## 5. The performance budget is breached on main-equivalent code, on two machines

The one job still red. It is not this PR and it is not the runner.

The gate has never run against these ceilings. `perf/route-budgets.json` was
ratcheted on 4 September at 09:28 (#1416), and every CI run on `main` from
4 September 07:43 onward reports every job as failure, which is the billing
fault rather than a test result: the run at the ratchet commit itself has all
fifteen checks red. Fifty-five commits have landed on `main` since the last job
actually executed.

Measured here against a local production build of this branch, on a private
port, with the same spec the job runs, beside the Avrea figures:

| route | metric | ceiling | Avrea | this Mac |
| --- | --- | ---: | ---: | ---: |
| /map | requests | 160 | 335 | 335 |
| /map | lcpMs | 900 | 2184 | 1416 |
| /drinks | lcpMs | 400 | 772 | 820 |
| /messages | lcpMs | 800 | 844 | 1024 |
| /onboarding | lcpMs | 900 | 964 | 1244 |
| /crawls | lcpMs | 300 | 336 | 332 |
| /historic | lcpMs | 400 | 460 | 452 |
| /moment | lcpMs | 300 | 312 | 332 |
| /drinks | jsDecodedKB | 1130 | 1242 | not breached |
| /today | lcpMs | 300 | 700 | not breached |

`/map` asks for 335 requests against a ceiling of 160 on BOTH machines, to the
request. A request count is not a CPU measurement, so that one is a real
regression in what the map fetches, not runner slowness. The LCP figures are
over on both machines too, by different amounts, which is what a slower host
does to a figure that is already over.

Nothing here is fixed in this PR, and no ceiling is moved: raising one would be
the exact move the ratchet exists to refuse, and the drift belongs to whichever
commit caused it. The likeliest place to start for `/map` is #1561 ("until the
pins have painted, the wire belongs to the pins"), which holds the shard ring
requests and replays them once a pin paints.
