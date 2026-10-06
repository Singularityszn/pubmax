# CI runbook

GitHub Actions workflows live under `.github/workflows/`. The merge bar for
application code is still `npm run verify` locally; Actions is the PR status
check layer.

## GitHub-hosted runners

Every job that runs Playwright uses `macos-latest`. Every other job uses
`ubuntu-latest`. The repository is public, so both are GitHub's free hosted
runners. Ubuntu font metrics wrap the landing hero differently from the
macOS metrics the law pins were proved on, so the browser jobs stay on
macOS. PostgreSQL, Semgrep and the rest stay on Linux. The performance
sweep once failed to measure itself on a private repository's 2 vCPU
runner; that is why it is not on the pull-request path. It is not a reason
to run a public repository's CI on a personal machine.

```yaml
# a job that runs Playwright
runs-on: macos-latest
# every other job
runs-on: ubuntu-latest
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

Browser law pins, the three browser layout-pin shards and the two `performance.yml` jobs keep `--workers=1`. The layout pins run on every pull request as three shards, because they alone hold the layout that source-text unit tests once pinned. The nightly full suite runs as four shards. Each keeps Playwright's default worker count, which `playwright.config.ts` leaves unset when `CI` is set, and a hosted macOS runner resolves that to one worker.

Each workflow has its own concurrency group. A newer pull request head supersedes that pull request's older runs of the same workflow, so rerun the latest workflow run for the current head. Main pushes, the nightly browser suite and manual dispatches never cancel. There is no repo-wide group and no shared browser queue.

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

See also `docs/CRON_PLANE_RUNBOOK.md` and `docs/teach.md` (local pre-push hook).
