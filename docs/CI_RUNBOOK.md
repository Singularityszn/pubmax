# CI runbook

GitHub Actions workflows live under `.github/workflows/`. The merge bar for
application code is still `npm run verify` locally; Actions is the PR status
check layer.

## Runners

Jobs use GitHub-hosted `ubuntu-latest` by default, including Browser law
pins. The `MACOS_JOBS` list in `__tests__/ciRunnerIsolation.test.ts` owns the
exceptions and their reasons. They run on the self-hosted `pubmax-mac` pool
(see "Self-hosted Mac runners" below):

- The layout pins and the two nightly full-suite jobs. Their specs were proved on
  macOS glyph widths. Both use the same self-hosted webfonts, but Linux
  Chromium draws some lines a few pixels wider. On 16 Oct 2026 four layout
  specs failed on `ubuntu-latest` (for example 7px short at 320px), and the
  full suite failed 19 more tests than the macOS nightly.
- The two `performance.yml` jobs. Their route budgets were measured on macOS.
- `prod-smoke.yml`. It runs once per production deploy.

GitHub's free plan runs about 20 hosted Linux jobs at once. Hosted macOS
jobs waited a long time in GitHub's queue, so the macOS jobs moved to the
`pubmax-mac` pool (captain, 6 Nov 2026). A pull request that changes code
takes 3 Mac jobs (the layout shards). A docs or data pull request takes none
(see "What a pull request runs"). The performance sweep once failed to
measure itself on a private repository's 2 vCPU runner; that is why it is
not on the pull-request path.

```yaml
# default, including Browser law pins
runs-on: ubuntu-latest
# the MACOS_JOBS list only
runs-on: pubmax-mac
```

`__tests__/ciRunnerIsolation.test.ts` checks those labels and the workflow's
fork condition. It does not check the external runner access controls below.
It also checks that a workflow that runs on `pull_request` does not reference
`secrets`. Refresh workflows that open a review PR do not trigger on
`pull_request`, so a fork never receives their job token or a repository
secret.

### What a job installs

A runner image does not carry the tools a job needs. Each job that needs
them installs them:

- **Node 22** via `actions/setup-node`, which matches `engines.node` in
  `package.json`. Jobs that run `npm ci` set `cache: npm`. See
  [Self-hosted Mac runners](#self-hosted-mac-runners) for Mac cache setup.
- **PostgreSQL 16 and PostgREST 14** in `rls-session.yml`. The harness starts
  its own cluster with `initdb` (`scripts/rls/postgresHost.mjs` already looks
  in `/usr/lib/postgresql/16/bin`), so the job installs the `postgresql-16`
  apt package and the checksummed `postgrest-v14.16` static binary. It does
  not use a service container.
- **Playwright Chromium** with `npx playwright install --with-deps chromium`
  in the browser and performance jobs. On macOS `--with-deps` needs no
  system packages or `sudo`. Playwright still installs Chromium.
- **zizmor 1.30.1, osv-scanner 2.6.0 and Semgrep 1.179.0** in
  `security-ci.yml`, each checksummed or version-pinned.

`PW_PORT` still comes from `.github/actions/pubmax-playwright-port`. Each
hosted job has its own network namespace, so two jobs cannot collide. A Mac
place derives its port from its runner name, or takes `PW_PORT` from the
runner environment. The action gives one job a single port.

### Self-hosted Mac runners

runner-up serves this repository's Mac places under the label `pubmax-mac`.
Today the pool has one host place on studio-1. Two tart virtual machine
places will join it. A place runs one job at a time, as its own macOS user,
with no `sudo`. So a Mac job:

- **Keeps its caches in the job.** The first step after Checkout is
  `.github/actions/pubmax-job-local-caches`. It points `npm_config_cache` and
  `PLAYWRIGHT_BROWSERS_PATH` at `RUNNER_TEMP`, which the runner empties at the
  start and end of every job. The default `~/.npm` and
  `~/Library/Caches/ms-playwright` would carry one job's downloads into the
  next. `actions/setup-node` still restores and saves the npm cache through
  GitHub's cache.
- **Installs Node with `actions/setup-node`** before any step that runs
  `node`. The place has no Node of its own. `Performance budget` records its
  start time with the shell for that reason.
- **Runs Playwright with one worker.** Without an explicit worker count,
  Playwright starts half the machine's cores. A hosted macOS
  runner gave one worker. studio-1 has 18 cores and would give 9, and four
  workers killed the single production server on 3-4 Oct 2026. Every Mac
  Playwright run passes `--workers=1`, or uses the prod-smoke config, which
  sets `workers: 1`.

The repository is public. The runner-up coordinator refuses jobs from forks
by default through its fork guard. This coordinator control is the runner
access boundary. The repository setting "Require approval for all outside
collaborators" adds a GitHub approval control. These controls sit outside
pull-request-controlled YAML.

The layout pins are the only Mac jobs on the pull-request path. Their `if`
condition adds defence in depth. A fork can edit workflow YAML, so this
condition cannot enforce runner access:

```yaml
(github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)
```

The other Mac jobs listen only for `schedule`, `workflow_dispatch` or
`deployment_status`. No workflow with a Mac job
listens for `pull_request_target`. A skipped job counts as passed in branch
protection, so a fork pull request reports its layout pins as skipped. Read
such a pull request's screen changes by hand, or push its branch to this
repository to run the pins.

Browser jobs need no shared queue: one place runs one job at a time, and
each hosted Linux job is its own machine.
`__tests__/browserJobConcurrency.test.ts` holds the browser jobs to that.

### Install scripts and credentials

- **No dependency runs an install script by default.** `.npmrc` (and
  `scripts/chatgpt-map/.npmrc`) set `ignore-scripts=true`. The `allowScripts`
  field of each `package.json` lists every lockfile package that declares one:
  `true` runs it, `false` skips it, and `scripts/ci/install-script-allowlist.mjs`
  records why. Each job that installs dependencies runs
  `npm run deps:install-scripts` straight after `npm ci`. This rebuilds the
  `true` rows (today only `esbuild`). `npm run verify` fails when a new
  package with an install script has no row.
- **`ignore-scripts` also skips npm's `pre` and `post` hooks**, so
  `package.json` has none. `build`, `dev`, `start`, `validate-data`,
  `build:slim` and `export:data` name their own first or last steps.
- **No checkout keeps the job token.** Every `actions/checkout` sets
  `persist-credentials: false`. The refresh jobs push their review branch
  through `scripts/ci/with-git-token.sh`, which hands `GH_TOKEN` to git through
  the environment of that one step and writes it nowhere.
- **Every remote action is pinned** to a commit SHA with its tag in a comment.
  Dependabot's `github-actions` updater moves the pins, with a seven-day
  cooldown like the npm updater.

### Security CI is advisory

`security-ci.yml` runs zizmor online over all of `.github/`, osv-scanner
recursively over every lockfile in the tree, Semgrep, and gitleaks, on every
pull request, every push to `main` and every Monday. No branch protection
requires these checks, so a red Security CI job blocks nothing by itself: read
it before merging. zizmor's `GH_TOKEN` is `github.token`, the job token, not a
repository secret.

gitleaks scans a different range for each event:

| Event | Range |
| --- | --- |
| Pull request | The complete history reachable from the checkout (`HEAD`). |
| Push to `main` | Only the pushed commits (`before..after`), including after a force push. When the previous head is all zeros or missing from the clone, it scans the complete history of the new head. |
| Weekly run and manual dispatch | Every ref (`--all`), so a secret on any branch is still found. |

A push to `main` once scanned every ref. A finding on an unmerged branch then
turned `main` red on every push, so the colour of `main` meant nothing. The
allowlists and their reasons are in `.gitleaks.toml`. One exact historical
finding that fits no allowlist shape goes in `.gitleaksignore`.

### Timeouts and job shape

Job `timeout-minutes` values in `ci.yml`, `e2e.yml`, `rls-session.yml`, and the Playwright jobs in `performance.yml` stay at the ceilings already set for those jobs (about 2× the p95 measured on the previous runners), with floors on the freshness gate (20 minutes) and Coverage (30 minutes). Do not raise one to hide a slow hosted run; see `perf/AGENTS.md`. `security-ci.yml` uses fixed ceilings (10, 15, and 45 minutes for zizmor, osv-scanner, and Semgrep).

Browser law pins keep `--workers=1`. [Self-hosted Mac runners](#self-hosted-mac-runners)
defines the worker limit for Mac jobs. [What a pull request runs](#what-a-pull-request-runs)
defines when the layout shards run.

The nightly full suite separates plain Chromium shards from the WebGL and
keyless projects. The [browser workflow](../.github/workflows/e2e.yml) owns
the shard matrix and project lists. Each Chromium shard builds one server.
`Full browser suite (WebGL and keyless)` builds both the normal and keyless
servers. These jobs use the worker limit defined above.
Scheduled runs and manual dispatches skip the layout-pin jobs because the full
suite covers those specs on the same commit.

Each workflow has its own concurrency group. A newer pull request head supersedes that pull request's older runs of the same workflow, so rerun the latest workflow run for the current head. The nightly browser suite and manual dispatches never cancel: each one gets a group of its own (`run-<run_id>`). Main pushes of `ci.yml`, `rls-session.yml` and `security-ci.yml` also get a group of their own. GitHub keeps only one waiting run per group, so the old per-ref group dropped waiting main pushes. There is no repo-wide group and no shared browser queue.

Main pushes of Browser tests (`e2e.yml`) share one group, `main-push` (owner decision, 19 Oct 2026). The run in progress always finishes. Only the newest push waits behind it, and GitHub cancels an older waiting push. Each main push starts three layout-pin jobs. On 19 Oct 2026, 22 merges queued 66 macOS jobs. The first layout shard of the 08:57 push started at 13:42, and a pull request's last layout shard waited 72 minutes for a runner. The newest main commit holds every older one, so main is still tested. When a main run fails, it can cover several merges: read the merges since the last green main run. The nightly full suite still runs on its own group.

`ci.yml` starts lint, the TypeScript 6 check, `production-build` and the
three unit shards at once (captain, 2 Nov 2026). None of them reads what another makes: the build and
the unit shards build their own data. Before that day the build waited for
lint, which put the two end to end on the slowest chain, and the suite ran in
two shards that finished up to 3 minutes apart. Each shard runs
`npm run coverage -- --without-postgres` on its third of the suite with
coverage thresholds off and writes a Vitest blob report. The Coverage job runs
after all three shards: it merges the blobs with
`npx vitest --merge-reports=blob-reports --coverage` and enforces the
thresholds in `vitest.config.mts` over the whole suite. So CI runs the unit
suite once, not once in the shards and again for coverage. The freshness job
runs on its own: a calendar breach is that job's red mark and does not skip the
build, the unit shards or coverage.

The freshness job installs Node without the npm cache or the application
dependencies. Both scripts use only Node built-ins. The first checks committed
candidate artifacts. The second reads production store observations through
`https://pubmaxxing.com/api/freshness`. Both checks still run on every change.

A shard cannot finish before its slowest test file. Vitest gives each file to
one worker and does not divide the tests in a file. So a test file that grows
past about 90 seconds on CI is split by topic. The parts share their setup
through a helper in `__tests__/helpers/`. The plan generation route tests
(499 seconds) and the pub website amenities runner tests (423 seconds) were
split this way on 2 Nov 2026.

The shards share out the files by measured time, not by count (captain,
2 Nov 2026). Vitest's own `--shard` cuts the files by a hash of their path
into equal counts, and on CI run 41468260511 one shard held 1,052 seconds of
tests while the others held 532 and 622. `vitest.config.mts` now uses
`scripts/ci/vitestShardBalance.mjs`, which places the longest file first, each
on the shard with the least time so far, from the per-file times in
`scripts/ci/vitest-shard-durations.json`. A file the list does not know weighs
the list's median, so a new test still runs. Every shard computes the same
split, so each file runs exactly once; `__tests__/vitestShardBalance.test.ts`
holds that. Refresh the times about once a month, or after a large change to
the suite: run `npm run coverage -- --without-postgres --reporter=json
--outputFile=<scratch>/unit.json`, then `npm run ci:shard-durations --
<scratch>/unit.json`. Only the relative sizes matter, so a local run is enough.

Locally, `npm run verify` runs `npm run coverage -- --without-postgres` and
then `npm run test:rls`, so each PostgreSQL suite runs once. The suites
`--without-postgres` excludes are the closed list in
`scripts/rls/postgresSuites.mjs`.

The Data validation job also runs on its own. It runs `npm run validate-data`,
the same data gate `npm run verify` starts with, with
`PUBMAX_VERIFY_COMMITTED_DATA=1`. No builder rewrites a committed pack, so the
job checks the packs as they ship. It first runs `npm run build:venue-details`,
which writes only the gitignored venue detail files.

The lint-and-types job and the merge bar `npm run verify` both run
[`npm run typecheck`](../package.json). It runs `next typegen` first, so the
`typedRoutes` link types exist, then the TypeScript 7 native `tsc`. A
separate job, `Typecheck (TypeScript 6)` (captain, 2 Nov 2026), runs
`next typegen` and then checks the same full tsconfig with the TypeScript 6
bridge compiler, `node node_modules/typescript/bin/tsc --noEmit`. It took 2:15
to 5:38 on hosted runners, so it runs beside lint rather than after it. Next resolves
that TypeScript 6 compiler API at build time; see
[`next.config.mjs`](../next.config.mjs) for why both exist. `npx tsc` resolves
to TypeScript 7, so call the TypeScript 6 compiler by its path. Because this
check covers every file the build's own check covers, the CI build skips its
copy; see [Build cache and type check](#build-cache-and-type-check).

### Build cache and type check

Next.js 16 keeps Turbopack's build work in `.next/cache` (`turbopackFileSystemCacheForBuild`, on by default). A hosted runner starts empty, so before 2 Nov 2026 every `Production build` was cold and wrote a cache that no run read. The job now restores `.next/cache` before `Build` with `actions/cache/restore`, keyed on the runner OS, the `package-lock.json` hash and the UTC date. A pull request restores the newest cache that a push to `main` saved for the same lockfile. Only a push to `main` saves one, with `actions/cache/save` after `Build`, and only when no cache for that day exists yet, so `main` saves at most one a day. A cache is about 500 MB, and the repository has 10 GB of cache space, emptied least recently used first; a cache per push (12 to 32 a day) could have pushed out the nightly Tavily cursor that `tavily-london-nightly.yml` reads once a day. A pull request never writes a cache that `main` reads. A lockfile change starts a new cache line, and the first build after it is cold. `__tests__/ciReleaseGateWorkflow.test.ts` holds the two steps. The measured gain and the next levers are in [`docs/plans/CI_SPEED_PLAN.md`](plans/CI_SPEED_PLAN.md).

`next build` also type-checks `tsconfig.build.json` with TypeScript 6. That took 3.0 of the 4:16 `Build` step in run 41450554289, and the `Typecheck (TypeScript 6)` job already checks `tsconfig.json`, which covers every file `tsconfig.build.json` does, with the same compiler options. So the CI `Build` step sets `PUBMAX_CI_SKIP_BUILD_TYPECHECK=1`, and `next.config.mjs` then sets `typescript.ignoreBuildErrors`, which skips the build's check entirely (captain, 2 Nov 2026). `next.config.mjs` ignores the variable when `VERCEL` is set, because a Vercel dashboard variable reaches Vercel builds too, so a deploy build always type-checks. A type error still fails `Typecheck (TypeScript 6)`, once that check is required in branch protection. Measured on a dev container: the whole `next build` took 377 seconds with the check and 83 seconds without it. `__tests__/ciReleaseGateWorkflow.test.ts` holds the variable, the wider check, the tsconfig coverage and the Vercel refusal. The browser jobs in `e2e.yml` and `performance.yml` build the app too, through the Playwright web server, so their build steps set the same variable: on a macOS runner the build's own type check took more than 6 minutes and pushed the web server past its 10 minute start limit on pull request 2468. `__tests__/e2eWorkflow.test.ts` holds that.

### What a pull request runs

A pull request that changes only docs or only data skips the heavy jobs (owner decision, 16 Oct 2026). Each heavy job's second step, `Classify the change`, diffs the pull request's merge commit against its first parent and names the scope:

- **docs**: every changed file is under `docs/` or ends in `.md`.
- **data**: every changed file is docs or data, and at least one is data (`data/**/*.json` or anything under `public/data/`).
- **code**: anything else. That includes an empty diff, any other file under `data/`, every `.github/` file that is not Markdown, and every event that is not a pull request. A push to `main` always runs in full.

The diff runs with `--no-renames`, so a file moved counts under both its old and its new path. A pull request that moves `lib/` code into `docs/` reads as code, not docs.

The job still starts and reports. Only its steps are skipped, so it shows green under its real name. A matrix job skipped at the job level reports one check under its unexpanded name, `Unit tests (${{ matrix.shard }}/3)`, and a required `Unit tests (1/3)` would then wait for ever. That is why no Linux job is skipped whole. The gated checkouts fetch two commits, the merge and its base. Every copy of the classifier is identical, and `__tests__/ciChangeScope.test.ts` holds them to that and runs them.

The macOS layout pins are the one exception (owner decision, 17 Oct 2026). A job that starts only to skip its steps still holds a runner. Before the Mac pool migration, three layout shards per pull request filled the hosted macOS queue. Docs-only pull requests waited up to 53 minutes for a job that then ran for 1 minute. In `e2e.yml` one Linux job, `Change scope`, runs the classifiers. `Browser layout pins (1/3)`, `(2/3)` and `(3/3)` are three named jobs that need it. When `Change scope` succeeds and `Classify the layout change` outputs `none`, GitHub skips all three jobs without starting a Mac job. If `Change scope` fails, the layout jobs run for events eligible under [Self-hosted Mac runners](#self-hosted-mac-runners). This preserves layout checks when classification fails, because branch protection counts a skipped check as passed. The three jobs share one step list through a YAML anchor and differ only in `LAYOUT_SHARD`.

The layout scope uses a denylist (captain, 23 Oct 2026). A pull request reads `none` only when every changed file belongs to these categories:

- Unit tests under `__tests__/`.
- Data files under `data/` or `public/data/`.
- Database migrations and rollbacks under `supabase/migrations/` or `supabase/rollbacks/`.
- Files under `docs/` and Markdown files ending in `.md`.
- Files under `scripts/` except `scripts/e2e/canonical-price-server.ts`. The registered web first-run journey directly starts that fixture for its fixed-time price checks.
- API-only files under `app/api/` and JavaScript or TypeScript `route` handlers under `app/` that render no page.

Every other changed file reads `ui`. Eligible events then run all three layout jobs. This includes every `lib/` module, components, pages, styles, browser specs, helpers, fixtures, and workflows. The Playwright port action, configuration, `package.json`, lockfiles, and unknown paths also read `ui`.

An empty diff and every event other than a pull request read `ui`. The [browser job schedule](#timeouts-and-job-shape) controls which jobs run for each event. `__tests__/ciChangeScope.test.ts` executes the classifier on sample diffs and on each spec selected by the layout job.

| Check | docs only | data only | code |
| --- | --- | --- | --- |
| CI / Review scope | runs | runs | runs |
| CI / Lint and typecheck | green, steps skipped (ESLint reads no `.md`) | runs (a JSON pack can be imported by TypeScript) | runs |
| CI / Typecheck (TypeScript 6) | green, steps skipped | runs (a JSON pack can be imported by TypeScript) | runs |
| CI / Production build | green, steps skipped | green, steps skipped | runs |
| CI / Unit tests (1/3) | unit tests whose source names a changed file, PostgreSQL suites aside | same | whole third, with coverage |
| CI / Unit tests (2/3) | green, steps skipped | green, steps skipped | whole third, with coverage |
| CI / Unit tests (3/3) | green, steps skipped | green, steps skipped | whole third, with coverage |
| CI / Coverage | green, steps skipped | green, steps skipped | merges and enforces thresholds |
| CI / Freshness release gate | runs | runs | runs |
| CI / Data validation | runs | runs | runs |
| Browser tests / law pins | green, steps skipped | green, steps skipped | runs |
| Browser tests / Change scope | runs (Linux, classifier only) | runs | runs |
| Browser tests / layout pins (1-3/3) | skipped, no Mac place | skipped, no Mac place | runs for a `ui` change, skipped for `none` and for a fork |
| Browser tests / full suite | not run on pull requests (nightly and dispatch only) | same | same |
| RLS session tests | green, steps skipped | green, steps skipped | runs |
| Security CI (zizmor, osv-scanner, Semgrep) | runs | runs | runs |

The named-test step covers fences that read the very file a pull request changed, such as an `AGENTS.md`, a pack or `data/freshness_registry.json`. It selects every `__tests__/*.test.ts(x)` file that names a changed file by path or by file name. A browser pin or a unit test that reads data without naming the file is not run until the merge reaches `main`, which runs everything. The local merge bar, `npm run verify`, is unchanged.

### Prove the runner

`self-hosted-probe.yml` is `workflow_dispatch` only. It checks out, installs
Node 22 and prints `node --version` on `ubuntu-latest`. It does not check a
Mac place. To see which place ran a Mac job, read the job log's "Runner name"
line, or list the jobs of a run:

```sh
gh api repos/Singularityszn/pubmax/actions/runs/<run-id>/jobs --jq '.jobs[] | [.name, .runner_name, (.labels | join(","))] | @tsv'
```

```sh
gh workflow run self-hosted-probe.yml
gh run list --workflow self-hosted-probe.yml --limit 1
```

## Scheduled work split

| Job | Plane |
| --- | --- |
| What's-On bounded + official events refresh | Vercel `GET /api/cron/refresh-whats-on` (primary) |
| What's-On GitHub recovery | `events-refresh.yml` (`workflow_dispatch` only; schedule disabled as duplicate) |
| Weather cache PR | `weather-refresh.yml` |
| Drink price PR | `drink-price-refresh.yml` |
| London Tavily pass PR | `tavily-london-nightly.yml` (see `docs/TAVILY_LONDON_NIGHTLY.md`) |
| Performance budgets | `performance.yml` |
| Production uptime, every five minutes | `uptime.yml` (alerts through `alert-on-failure.yml`) |
| Browser law pins, layout pins + nightly suite | `e2e.yml` |

If the repository does not let GitHub Actions open pull requests, the weather
and What's-On refreshes still push their review branch. They log the branch link
as a warning and the run stays green. Open that PR by hand. The setting is in
Settings, Actions, General: "Allow GitHub Actions to create and approve pull
requests". Only the captain changes it.

See also `docs/CRON_PLANE_RUNBOOK.md` and `docs/teach.md` (local pre-push hook).
