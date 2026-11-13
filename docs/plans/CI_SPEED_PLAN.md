# CI speed plan

Status: LEVERS 1 TO 4 SHIPPING. Lever 1 ships in the pull request that adds this plan. On 2 Nov 2026 the captain approved levers 2, 3 and 4 (three unit shards), and they ship in the same pull request. Levers 5 and 6 wait for the captain. See lever 7 for browser-work status.

Rule: [CI SPEED WORK STARTS FROM A MEASURED CRITICAL PATH](../rules/scripts-ci-gates-and-audits.md#ci-speed-work-starts-from-a-measured-critical-path). Skills: `ci-speedup`, `ci-score` and `ci-secure`, user-level skills installed in `~/.agents/skills` (provenance in the git history of [`.agents/skills/SOURCES.md`](../../.agents/skills/SOURCES.md)).

## 1. What happened

On 2 Nov 2026 the captain asked for three things:

- read the ten StarSling CI playbooks at https://starsling.dev/ci-playbooks;
- install the StarSling skills (`npx skills add starslingdev/skills`);
- remember them, and use them to make GitHub Actions faster.

The skills are now project skills. A rule in `docs/rules/scripts-ci-gates-and-audits.md` tells every agent to start CI speed work from a measurement. This plan holds the measurement, the playbook map and the ranked changes.

## 2. What a pull request waits for today

The [CI runbook](../CI_RUNBOOK.md#the-required-checks-and-the-merge-queue) owns the current merge requirements. The table shows `CI` for three green code pull requests measured on 2 Nov 2026. Times are minutes and seconds, read from the GitHub Actions job timings.

| Pull request and run | Total | Wait for a runner | Lint and typecheck job | Production build job (starts after lint) | Slower unit shard | Faster unit shard |
| --- | --- | --- | --- | --- | --- | --- |
| #2466, run 41450554289 | 14:37 | 0:40 | 8:14 (lint 2:31, TS7 0:36, TS6 3:59) | 5:40 (`Build` 4:16) | 11:31 (tests 10:04) | 8:43 (tests 7:36) |
| #2463, run 41408900766 | 16:12 | 5:22 | 5:02 (lint 1:24, TS7 0:20, TS6 2:15) | 5:45 (`Build` 4:14) | 9:06 (tests 7:48) | 8:40 (tests 7:24) |
| #2464, run 41420359339 | 12:58 | 0:13 | 7:37 (lint 2:21, TS7 0:34, TS6 3:49) | 4:57 (`Build` 3:59) | 9:35 (tests 8:25) | 6:22 (tests 5:35) |

What the numbers say:

1. **The slowest chain is lint and typecheck, then the production build.** It was the slowest chain in all three runs: 10:50 to 13:57 from the first job's start. The unit chain (shards, then Coverage) ended 0.5 to 2 minutes earlier.
2. **Most of the `Build` step is a second type check.** The log of run 41450554289 splits its 4:16 `Build` step into: data builders 0:10, Turbopack compile 0:46, **TypeScript check 3:00**, page data and static pages 0:18. The lint job's TS6 step already checks `tsconfig.json`, which includes every file `tsconfig.build.json` includes, with the same compiler options. So the app code is type-checked twice with TypeScript 6 on the slowest chain.
3. **The production build is always cold.** The same log says `No build cache found`. Next.js 16 writes a Turbopack build cache to `.next/cache`, but a hosted runner starts empty and no step restored it.
4. **The unit shards are not balanced.** In two runs, one shard took 2.5 to 3 minutes longer than the other.
5. **Runner queue time is real when Dependabot opens many pull requests at once.** On #2463 every job waited about 5 minutes for a runner.
6. **`Browser tests` is longer for a UI change.** On #2466 one macOS layout-pin shard ran 13.5 minutes of tests and another ran more than 16 minutes before a new push cancelled it. One shard waited 5 minutes for a macOS runner (the free plan has 5). The Linux law pins took 9 minutes.

## 3. The ten playbooks, applied to this repository

Each playbook comes from one company's public posts and pull requests. The table gives each playbook's headline technique and what it means here.

| Playbook | Headline technique | Here |
| --- | --- | --- |
| [Anthropic](https://starsling.dev/ci-playbooks/anthropic) | Run only affected tests | **Refused.** The CI unit shards run the whole suite by owner decision (16 Oct 2026). The local gate is already change-scoped. Its other techniques fit: save shared caches only from the default branch (lever 1), cache compiled lint tools (lever 5), run build-free checks without waiting for the build (lever 3), and balance shards to within one file (lever 4). |
| [DoorDash](https://starsling.dev/ci-playbooks/doordash) | Run build and test in parallel, sharded | **Done for tests.** Unit tests already start beside lint. DoorDash's "turn off a build cache that CI never restores" is exactly finding 3: lever 1 restores it. "Run lint beside the build" is lever 3. |
| [Linear](https://starsling.dev/ci-playbooks/linear) | Benchmark the same job on faster hardware | **Not now.** Larger runners cost money. Linear's "native compiler for type checking" is half done: TS7 runs in 0:20 to 0:36, and the second TS6 check is lever 2. "Balance test files before buying more shards" is lever 4. |
| [Mastra](https://starsling.dev/ci-playbooks/mastra) | StarSling runners for the slowest workflow | **Not now.** A paid runner service is a captain decision and a new vendor. "Bound jobs that can hang" is done: every job has `timeout-minutes`. |
| [OpenAI](https://starsling.dev/ci-playbooks/openai) | Rank CI fixes by the minutes they save | **Adopted.** This plan ranks every lever by minutes off the slowest chain. |
| [Ramp](https://starsling.dev/ci-playbooks/ramp) | Move a CPU-bound suite to a faster CPU | **Not now** (same reason as Linear). "Persist the compiler cache and warm it from the default branch" is lever 1. |
| [Shopify](https://starsling.dev/ci-playbooks/shopify) | Let an agent iterate against one CI metric | **Adopted as the rule.** The one metric is the slowest chain's minutes. "Let tests start without waiting for lint" is done. "Run expensive checks when a draft becomes ready" is refused: agents open every pull request as a draft. |
| [Spotify](https://starsling.dev/ci-playbooks/spotify) | Build arm64 on native arm64 runners | **Does not apply.** We build no images. "Cap hung test jobs with timeouts" is done. |
| [Stripe](https://starsling.dev/ci-playbooks/stripe) | Run only the tests a change can reach | **Refused** for CI (same owner decision as Anthropic). "Cancel superseded pull request runs" is done. "Balance shards and keep a catch-all for new tests" is lever 4. |
| [Uber](https://starsling.dev/ci-playbooks/uber) | Build the likely merge-queue speculations | See the [CI runbook](../CI_RUNBOOK.md#the-required-checks-and-the-merge-queue) for queue configuration. "Persist the build cache between runners" is lever 1. |

The twelve techniques that appear in the most playbooks, and where this repository stands:

| Technique | Playbooks | Here |
| --- | --- | --- |
| Cache dependencies | 9 of 10 | Done: `setup-node` caches npm in every job. |
| Measure test concurrency | 9 of 10 | Not measured. Vitest picks its worker count. Measure it before adding a fourth shard. |
| Shard long test jobs | 8 of 10 | Done: two unit shards, three layout-pin shards, eight nightly shards. |
| Run independent steps in parallel | 7 of 10 | Done in this pull request: the build no longer waits for lint (lever 3). |
| Move slow jobs to faster runners | 6 of 10 | Not now: it costs money. |
| Remove duplicate commands | 5 of 10 | One found and removed in this pull request: the TS6 check ran in the lint job and inside `next build` (lever 2). |
| Balance test shards | 5 of 10 | Three shards in this pull request (lever 4). |
| Check out shallow history | 5 of 10 | Done: two commits for the scoped jobs. Review scope keeps full history because it diffs the branch. |
| Run only the affected apps | 5 of 10 | Done in our own way: each job reads the change scope (docs, data or code). |
| Cancel superseded runs | 5 of 10 | Done on every pull request workflow. Main pushes of `Browser tests` share one group. |
| Set job timeouts | 5 of 10 | Done on every job. |
| Cache large downloads | 4 of 10 | See the [Mac cache policy](../CI_RUNBOOK.md#self-hosted-mac-runners). |

`ci-score` gives this repository 75 out of 100. Its two failed checks are decisions, not defects: no `paths` filter (a filtered workflow leaves a required check waiting for ever, so each job reads the change scope instead), and `fetch-depth: 0` on Review scope (it diffs the whole branch).

## 4. The levers, ranked by minutes off the slowest chain

Today the slowest chain is lint and typecheck (5:02 to 8:14), then the production build (4:57 to 5:45). Levers 2, 3 and 4 together would take it to about 8 to 9 minutes: the unit chain, after balancing, becomes the slowest.

| Lever | Minutes off the slowest chain | Status |
| --- | --- | --- |
| 1. Restore the Next.js build cache | about 0.3 to 0.5 | Ships in this pull request |
| 2. Type-check the app code once, not twice | about 3 | Approved 2 Nov 2026, ships in this pull request |
| 3. Start the production build beside lint | 1 to 2 now, more after lever 2 | Approved 2 Nov 2026, ships in this pull request |
| 4. Balance the unit shards | 2.5 to 3 off the unit chain | Approved 2 Nov 2026 as three shards, ships in this pull request |
| 5. Cache ESLint's work | up to about 2 | Captain decides |
| 6. Spread Dependabot over the day | up to 5 of queue, only in a burst | Captain decides |
| 7. Smaller wins in Browser tests | 0.2 to 2.5 per browser job | See lever 7 below |

### Lever 1. Restore the Next.js build cache (ships in this pull request)

- **Change:** the `Production build` job restores `.next/cache` before `Build`. Only a push to `main` saves a cache. A pull request reads the newest `main` cache for the same lockfile. See [`docs/CI_RUNBOOK.md`](../CI_RUNBOOK.md#build-cache-and-type-check).
- **Measured on this machine:** the same `next build`, run twice into one empty build directory. The Turbopack compile took 53 seconds cold and 16.9 seconds warm. The cache is 505 MB. The whole `next build` took 377 seconds cold and 343 seconds warm, so the cache saved 34 seconds. In both runs the TypeScript check took 5.1 minutes, and the cache does not touch it.
- **Expected in CI:** the CI compile took 46 seconds cold, so a warm cache saves about 30 seconds, less the time to download the cache. The first pull requests after merge stay cold until a `main` push saves a cache. The log line `No build cache found` goes away.
- **Risk:** low. Next validates its own cache. A lockfile change starts a new cache line. Only `main` writes a cache, so a pull request cannot write a cache that `main` reads, and pull requests do not fill the repository's 10 GB cache space.
- **Why ship it although it is small:** four playbooks (Anthropic, DoorDash, Ramp, Uber) name it, it changes no check, and it costs nothing on a pull request.

### Lever 2. Type-check the app code once, not twice (approved 2 Nov 2026)

- **Change:** the CI build skips its own type check, because the CI TypeScript 6 check already checks a superset with the same compiler; since lever B it runs in its own job, `Typecheck (TypeScript 6)`. The CI `Build` step sets `PUBMAX_CI_SKIP_BUILD_TYPECHECK=1`, and `next.config.mjs` then sets `typescript.ignoreBuildErrors`. `next.config.mjs` ignores the variable on Vercel, so a deploy build keeps the check.
- **Measured on this machine:** the whole `next build` took 83 seconds with the skip, against 377 seconds cold with the check. The log says `Skipping validation of types`.
- **Saving:** about 3 minutes off the slowest chain on every code pull request (the measured `Running TypeScript` phase).
- **What it gives up:** the CI build no longer proves the types on its own. The [CI runbook](../CI_RUNBOOK.md#build-cache-and-type-check) explains the separate type check and its merge enforcement.
- **Why the captain decides:** it changes what a check proves, even though nothing new can go red.

### Lever 3. Start the production build beside lint (approved 2 Nov 2026)

- **Change:** remove `needs: [lint-and-types]` from `production-build`. `__tests__/ciReleaseGateWorkflow.test.ts` pins that line, so the change edits the pin too.
- **Saving:** the slowest chain becomes the longer of lint, build and the unit chain. That is 1 to 2 minutes now and about 4 minutes after lever 2.
- **Cost:** when lint fails, the build still runs: about 5 extra runner minutes on a failed pull request. The check names do not change.

### Lever 4. Three unit shards (approved 2 Nov 2026)

- **Change:** three shards instead of two (the captain's choice). The Coverage job merges all three blobs, so the whole-suite coverage gate is unchanged.
- **Saving:** the slower shard ran 2.5 to 3 minutes longer than the faster one in two of three runs. Three shards would bring each to about 5 to 6 minutes of tests.
- **Cost:** about 1 extra runner minute per run for the third job's setup. See the [CI runbook](../CI_RUNBOOK.md#the-required-checks-and-the-merge-queue) for the required checks.

### Lever 5. Cache ESLint's work between runs (captain decides)

- **Change:** `eslint --cache --cache-strategy content` with the cache file restored from `main`, the same way as lever 1.
- **Saving:** the `Lint` step takes 1:24 to 2:31. A warm cache usually cuts most of that on a small change. Measure before shipping.
- **Cost:** a stale cache can hide a lint error when a rule reads files other than the one it lints. A key on the lockfile and the ESLint config limits that risk.

### Lever 6. Stop Dependabot bursts from queuing every job (captain decides)

- **Change:** spread Dependabot's update groups over different hours, or lower its open pull request limit.
- **Saving:** up to 5 minutes of queue time on every pull request opened during a burst.
- **Cost:** dependency updates arrive more slowly.

### Lever 7. Smaller wins in Browser tests (captain decides)

- Balance the three macOS layout-pin shards by duration. Done (captain, 9 Nov 2026): see the [CI runbook](../CI_RUNBOOK.md#timeouts-and-job-shape).
- Shorten fixed waits in browser specs: `ci-speedup` counts about 65 seconds of `waitForTimeout` across 76 spec files.

### Also found (not speed)

`ci-secure` found no attack path in the changed workflow. It reports five medium findings: install scripts may run in five scheduled workflows that hold secrets (`events-refresh.yml`, `prod-smoke.yml`, `tavily-london-nightly.yml`, `weather-refresh.yml`, `weekly-digest.yml`). `.npmrc` sets `ignore-scripts=true`, so these need a separate look before anyone calls them real.

## 5. How to measure again

1. Read the step timings of three green code pull requests with the GitHub MCP `actions_list` tool (`list_workflow_jobs`), or run `ci-speedup` where `gh` is signed in.
2. Name the slowest chain, then compare it with section 2.
3. Run `python3 ~/.agents/skills/ci-score/scripts/collect_config.py --repo . --out <scratch>/score.json` to re-score the configuration.

## 6. After the first measurement (2 Nov 2026)

The first CI run with levers 1 to 4 (run 41468260511) took 11:28. The build fell to 2:25, but two things held the total:

1. Vitest shares files out by a hash of their path, so one unit shard held 1,052 seconds of tests and the others 532 and 622. Two test files of 499 and 423 seconds had already been split by topic, with identical test names before and after.
2. The TypeScript 6 check in the lint job took between 2:15 and 5:38 from run to run.

The captain approved both fixes:

- **A. Balanced shards.** `vitest.config.mts` shares the files out by measured time, from `scripts/ci/vitest-shard-durations.json`. On the measured suite the three shards differ by less than 10 per cent.
- **B. A separate TypeScript 6 job,** `Typecheck (TypeScript 6)`, beside lint.

## 7. Decisions for the captain

Decided on 2 Nov 2026: levers 2 and 3, lever 4 as three unit shards, balanced shards, and a separate TypeScript 6 job.

1. Merge enforcement follows the [CI runbook](../CI_RUNBOOK.md#the-required-checks-and-the-merge-queue). Its ruleset procedure replaces the earlier raw-job requirements.
2. Lever 5: may CI cache ESLint's work from `main`?
3. Lever 6: spread Dependabot over the day?
4. Faster paid runners (Linear, Ramp, Mastra): not now, or try one job?
