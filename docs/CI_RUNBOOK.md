# CI runbook

GitHub Actions workflows live under `.github/workflows/`. The merge bar for
application code is still `npm run verify` locally; Actions is the PR status
check layer.

## GitHub-hosted runners

Every job runs on `ubuntu-latest`. The repository is public, so CI uses
GitHub's free hosted runners. No job needs macOS: Playwright, PostgreSQL,
Semgrep and the performance sweep all run on Linux. The sweep once failed to
measure itself on a private repository's 2 vCPU runner; that is why it is not
on the pull-request path. It is not a reason to run a public repository's CI
on a personal machine.

```yaml
runs-on: ubuntu-latest
```

`__tests__/ciRunnerIsolation.test.ts` holds that label, and it holds the
secret rule: a workflow that runs on `pull_request` does not reference
`secrets`, and a repository secret other than `GITHUB_TOKEN` is passed only
when the event is `push` or `schedule`. `GITHUB_TOKEN` is the job token.
Refresh workflows that open a review PR do not trigger on `pull_request`, so
a fork never receives that token. A manual `workflow_dispatch` does not
receive Ticketmaster, Skiddle, Resend or Supabase secrets.

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

`scripts/ci/setup-dedicated-runner-user.sh` and
`scripts/ci/assert-runner-identity.sh` exit immediately and print `retired`.
Neither workflow calls the identity check. There is no console-user guard and
no shared browser queue: each hosted job is its own machine.
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

Browser law pins and the two `performance.yml` jobs keep `--workers=1`. The nightly full-suite shards keep Playwright's default, which `playwright.config.ts` leaves unset when `CI` is set.

Each workflow has its own concurrency group. A newer pull request head supersedes that pull request's older runs of the same workflow, so rerun the latest workflow run for the current head. Main pushes, the nightly browser suite and manual dispatches never cancel. There is no repo-wide group and no shared browser queue.

`ci.yml` chains the code jobs (`production-build` after lint, unit shards
`max-parallel: 1`, coverage after unit tests). The freshness job runs on its
own: a calendar breach is that job's red mark and does not skip the build,
the unit shards or coverage.

The lint-and-types job runs `npx tsc --noEmit`. Next resolves the TypeScript 6
compiler API at build time. The merge bar `npm run verify` runs
[`npm run typecheck`](../package.json) (TypeScript 7 native); see
[`next.config.mjs`](../next.config.mjs) for why both exist.

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
| What's-On GitHub recovery | `events-refresh.yml` (`workflow_dispatch` only; schedule disabled as duplicate; provider secrets only if the event is push or schedule) |
| Weather cache PR | `weather-refresh.yml` |
| Drink price PR | `drink-price-refresh.yml` |
| Performance budgets | `performance.yml` |
| Browser law pins + nightly suite | `e2e.yml` |

See also `docs/CRON_PLANE_RUNBOOK.md` and `docs/teach.md` (local pre-push hook).
