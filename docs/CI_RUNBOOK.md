# CI runbook

GitHub Actions workflows live under `.github/workflows/`. The merge bar for
application code is still `npm run verify` locally; Actions is the PR status
check layer.

## GitHub-hosted runners

Every job uses `ubuntu-latest`, including Browser law pins. Five Playwright
jobs stay on `macos-latest`, each with a reason in `MACOS_JOBS` in
`__tests__/ciRunnerIsolation.test.ts`:

- The layout pins and the nightly full suite. Their specs were proved on
  macOS glyph widths. Both use the same self-hosted webfonts, but Linux
  Chromium draws some lines a few pixels wider. On 16 Oct 2026 four layout
  specs failed on `ubuntu-latest` (for example 7px short at 320px), and the
  full suite failed 19 more tests than the macOS nightly.
- The two `performance.yml` jobs. Their route budgets were measured on macOS.
- `prod-smoke.yml`. It runs once per production deploy.

The repository is public, so both are GitHub's free hosted runners. The free
plan runs about 20 Linux jobs at once but only 5 macOS jobs. A pull request
that changes code takes 3 macOS jobs (the layout shards). A docs or data pull
request takes none (see "What a pull request runs"). The performance
sweep once failed to measure itself on a private repository's 2 vCPU
runner; that is why it is not on the pull-request path. It is not a reason
to run a public repository's CI on a personal machine.

```yaml
# every job, including Browser law pins
runs-on: ubuntu-latest
# the MACOS_JOBS list only
runs-on: macos-latest
```

`__tests__/ciRunnerIsolation.test.ts` holds those labels, and it holds the
secret rule: a workflow that runs on `pull_request` does not reference
`secrets`. Refresh workflows that open a review PR do not trigger on
`pull_request`, so a fork never receives their job token or a repository
secret.

### What a job installs

The hosted image does not carry the tools the Mac used to. Each job that
needs them installs them:

- **Node 22** via `actions/setup-node`, which matches `engines.node` in
  `package.json`. Jobs that run `npm ci` set `cache: npm`. The old ban on
  that cache was a self-hosted stall; it does not apply here.
- **PostgreSQL 16 and PostgREST 14** in `rls-session.yml`. The harness starts
  its own cluster with `initdb` (`scripts/rls/postgresHost.mjs` already looks
  in `/usr/lib/postgresql/16/bin`), so the job installs the `postgresql-16`
  apt package and the checksummed `postgrest-v14.16` static binary. It does
  not use a service container.
- **Playwright Chromium** with `npx playwright install --with-deps chromium`
  in the browser and performance jobs.
- **zizmor 1.30.1, osv-scanner 2.6.0 and Semgrep 1.179.0** in
  `security-ci.yml`, each checksummed or version-pinned.

`PW_PORT` still comes from `.github/actions/pubmax-playwright-port`. Each
hosted job has its own network namespace, so two jobs cannot collide. The
action still gives one job a single port.

### Retired Mac runners

The self-hosted runners (`karan-mac-pubmax`, `-2`, `-3` with label
`pubmax-mac`, and `karan-mac-pubmax-refresh` with label `pubmax-mac-refresh`)
are retired. Do not register them again. A public repository's pull request
code must not run on a personal machine, and that shared Mac was the
browser-test timeout of 3-4 Oct 2026.

There is no console-user guard and no shared browser queue: each hosted job
is its own machine.
`__tests__/browserJobConcurrency.test.ts` holds the browser jobs to that.

### Install scripts and credentials

- **No dependency runs an install script by default.** `.npmrc` (and
  `scripts/chatgpt-map/.npmrc`) set `ignore-scripts=true`. The `allowScripts`
  field of each `package.json` lists every lockfile package that declares one:
  `true` runs it, `false` skips it, and `scripts/ci/install-script-allowlist.mjs`
  records why. Every job runs `npm run deps:install-scripts` straight after
  `npm ci` to rebuild the `true` rows (today only `esbuild`), and `npm run
  verify` fails when a new package with an install script has no row.
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
recursively over every lockfile in the tree, and Semgrep, on every pull
request, every push to `main` and every Monday. No branch protection requires
these checks, so a red Security CI job blocks nothing by itself: read it before
merging. zizmor's `GH_TOKEN` is `github.token`, the job token, not a
repository secret.

### Timeouts and job shape

Job `timeout-minutes` values in `ci.yml`, `e2e.yml`, `rls-session.yml`, and the Playwright jobs in `performance.yml` stay at the ceilings already set for those jobs (about 2× the p95 measured on the previous runners), with floors on the freshness gate (20 minutes) and Coverage (30 minutes). Do not raise one to hide a slow hosted run; see `perf/AGENTS.md`. `security-ci.yml` uses fixed ceilings (10, 15, and 45 minutes for zizmor, osv-scanner, and Semgrep).

Browser law pins, the three browser layout-pin shards and the two `performance.yml` jobs keep `--workers=1`. [What a pull request runs](#what-a-pull-request-runs) defines when the layout shards run. The nightly full suite runs as four shards. Each keeps Playwright's default worker count, which `playwright.config.ts` leaves unset when `CI` is set, and a hosted macOS runner resolves that to one worker.

Each workflow has its own concurrency group. A newer pull request head supersedes that pull request's older runs of the same workflow, so rerun the latest workflow run for the current head. The nightly browser suite and manual dispatches never cancel: each one gets a group of its own (`run-<run_id>`). Main pushes of `ci.yml`, `rls-session.yml` and `security-ci.yml` also get a group of their own. GitHub keeps only one waiting run per group, so the old per-ref group dropped waiting main pushes. There is no repo-wide group and no shared browser queue.

Main pushes of Browser tests (`e2e.yml`) share one group, `main-push` (owner decision, 19 Oct 2026). The run in progress always finishes. Only the newest push waits behind it, and GitHub cancels an older waiting push. Each main push holds 3 of the 5 macOS runners for the layout pins. On 19 Oct 2026, 22 merges queued 66 macOS jobs. The first layout shard of the 08:57 push started at 13:42, and a pull request's last layout shard waited 72 minutes for a runner. The newest main commit holds every older one, so main is still tested. When a main run fails, it can cover several merges: read the merges since the last green main run. The nightly full suite still runs on its own group.

`ci.yml` starts lint and the two unit shards at once. `production-build` runs
after lint. The unit shards wait on nothing, because they build their own slim
data, and they run in parallel. Each shard runs
`npm run coverage -- --without-postgres` on its half of the suite with
coverage thresholds off and writes a Vitest blob report. The Coverage job runs
after both shards: it merges the two blobs with
`npx vitest --merge-reports=blob-reports --coverage` and enforces the
thresholds in `vitest.config.mts` over the whole suite. So CI runs the unit
suite once, not once in the shards and again for coverage. The freshness job
runs on its own: a calendar breach is that job's red mark and does not skip the
build, the unit shards or coverage.

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
`typedRoutes` link types exist, then the TypeScript 7 native `tsc`. The
lint-and-types job then checks the same full tsconfig with the TypeScript 6
bridge compiler, `node node_modules/typescript/bin/tsc --noEmit`. Next resolves
that TypeScript 6 compiler API at build time; see
[`next.config.mjs`](../next.config.mjs) for why both exist. `npx tsc` resolves
to TypeScript 7, so call the TypeScript 6 compiler by its path.

### What a pull request runs

A pull request that changes only docs or only data skips the heavy jobs (owner decision, 16 Oct 2026). Each heavy job's second step, `Classify the change`, diffs the pull request's merge commit against its first parent and names the scope:

- **docs**: every changed file is under `docs/` or ends in `.md`.
- **data**: every changed file is docs or data, and at least one is data (`data/**/*.json` or anything under `public/data/`).
- **code**: anything else. That includes an empty diff, any other file under `data/`, every `.github/` file that is not Markdown, and every event that is not a pull request. A push to `main` always runs in full.

The diff runs with `--no-renames`, so a file moved counts under both its old and its new path. A pull request that moves `lib/` code into `docs/` reads as code, not docs.

The job still starts and reports. Only its steps are skipped, so it shows green under its real name. A matrix job skipped at the job level reports one check under its unexpanded name, `Unit tests (${{ matrix.shard }}/2)`, and a required `Unit tests (1/2)` would then wait for ever. That is why no Linux job is skipped whole. The gated checkouts fetch two commits, the merge and its base. Every copy of the classifier is identical, and `__tests__/ciChangeScope.test.ts` holds them to that and runs them.

The macOS layout pins are the one exception (owner decision, 17 Oct 2026). A job that starts only to skip its steps still holds a runner, and the free plan has only 5 macOS runners. Three layout shards per pull request filled that queue, and docs-only pull requests waited up to 53 minutes for a job that then ran for 1 minute. So in `e2e.yml` one Linux job, `Change scope`, runs the classifiers, and `Browser layout pins (1/3)`, `(2/3)` and `(3/3)` are three named jobs that need it. When `Change scope` succeeds and `Classify the layout change` outputs `none`, GitHub skips all three jobs without starting a macOS runner. If `Change scope` fails, the layout jobs run. This preserves layout checks when classification fails, because branch protection counts a skipped check as passed. The three jobs share one step list through a YAML anchor and differ only in `LAYOUT_SHARD`.

The layout scope uses a denylist (captain, 23 Oct 2026). A pull request reads `none` only when every changed file belongs to these categories:

- Unit tests under `__tests__/`.
- Data files under `data/` or `public/data/`.
- Database migrations and rollbacks under `supabase/migrations/` or `supabase/rollbacks/`.
- Files under `docs/` and Markdown files ending in `.md`.
- Files under `scripts/` that no layout spec directly runs. No current layout spec directly runs a repository script.
- API-only files under `app/api/` and JavaScript or TypeScript `route` handlers under `app/` that render no page.

Every other changed file reads `ui` and runs all three layout jobs. This includes every `lib/` module, components, pages, styles, browser specs, helpers, fixtures, and workflows. The Playwright port action, configuration, `package.json`, lockfiles, and unknown paths also read `ui`.

An empty diff and every event other than a pull request read `ui`. A push to `main`, a schedule, and a dispatch therefore run every layout pin. A failed classifier also runs the layout jobs. `__tests__/ciChangeScope.test.ts` executes the classifier on sample diffs and on each spec selected by the layout job.

| Check | docs only | data only | code |
| --- | --- | --- | --- |
| CI / Review scope | runs | runs | runs |
| CI / Lint and typecheck | green, steps skipped (ESLint reads no `.md`) | runs (a JSON pack can be imported by TypeScript) | runs |
| CI / Production build | green, steps skipped | green, steps skipped | runs |
| CI / Unit tests (1/2) | unit tests whose source names a changed file, PostgreSQL suites aside | same | whole half, with coverage |
| CI / Unit tests (2/2) | green, steps skipped | green, steps skipped | whole half, with coverage |
| CI / Coverage | green, steps skipped | green, steps skipped | merges and enforces thresholds |
| CI / Freshness release gate | runs | runs | runs |
| CI / Data validation | runs | runs | runs |
| Browser tests / law pins | green, steps skipped | green, steps skipped | runs |
| Browser tests / Change scope | runs (Linux, classifier only) | runs | runs |
| Browser tests / layout pins (1-3/3) | skipped, no macOS runner | skipped, no macOS runner | runs for a `ui` change, skipped for `none` |
| Browser tests / full suite (1-4/4) | not run on pull requests (nightly and dispatch only) | same | same |
| RLS session tests | green, steps skipped | green, steps skipped | runs |
| Security CI (zizmor, osv-scanner, Semgrep) | runs | runs | runs |

The named-test step covers fences that read the very file a pull request changed, such as an `AGENTS.md`, a pack or `data/freshness_registry.json`. It selects every `__tests__/*.test.ts(x)` file that names a changed file by path or by file name. A browser pin or a unit test that reads data without naming the file is not run until the merge reaches `main`, which runs everything. The local merge bar, `npm run verify`, is unchanged.

### Prove the runner

`self-hosted-probe.yml` is `workflow_dispatch` only. It checks out, installs
Node 22 and prints `node --version` on `ubuntu-latest`. It does not check a
Mac user.

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
| Browser law pins, layout pins + nightly suite | `e2e.yml` |

If the repository does not let GitHub Actions open pull requests, the weather
and What's-On refreshes still push their review branch. They log the branch link
as a warning and the run stays green. Open that PR by hand. The setting is in
Settings, Actions, General: "Allow GitHub Actions to create and approve pull
requests". Only the captain changes it.

See also `docs/CRON_PLANE_RUNBOOK.md` and `docs/teach.md` (local pre-push hook).
