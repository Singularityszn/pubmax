# CI runbook

GitHub Actions workflows live under `.github/workflows/`. The merge bar for
application code is still `npm run verify` locally; Actions is the PR status
check layer.

## Self-hosted runner (`pubmax-mac`)

While GitHub-hosted minutes are billing-locked, PR and scheduled jobs run on
self-hosted repo runners that share one Mac (among them **`karan-mac-pubmax`**),
each with labels `self-hosted`, `macOS`, `ARM64`, and **`pubmax-mac`**.
Workflows use:

```yaml
runs-on: [self-hosted, pubmax-mac]
```

### Machine prerequisites (Homebrew)

Install once on the runner Mac:

```sh
brew install postgresql@16 postgrest node@22 zizmor osv-scanner semgrep # Node must satisfy engines.node in package.json
npx playwright install chromium   # or let CI cache under ~/Library/Caches/ms-playwright
```

`security-ci.yml` invokes Homebrew `zizmor`, `osv-scanner`, and `semgrep` directly.
Semgrep uses `/etc/ssl/cert.pem` on macOS when Homebrew certifi paths are missing.
Accepted lockfile findings may be listed in `osv-scanner.toml` with reasons.

PostgreSQL clusters for RLS proofs use the serial harness in
`scripts/rls/postgresHost.mjs` (unique ports/data dirs per job, SysV slot
budget on macOS). Do not use GitHub `services:` Postgres on this runner.


### Serial execution on one Mac

GitHub may schedule several jobs at once; this runner uses one shared
`_work/{repo}/{repo}` checkout. Parallel jobs caused `validate-data` temp-dir
collisions, flaky `venueRoute` reads, and Playwright's
`run-with-restored-next-env` guard (`PUBMAX_TRACKED_OUTPUTS=public/data` for
`NEXT_PUBLIC_SW_VERSION=local` pack stamps). CI, browser tests and RLS therefore use:

```yaml
concurrency:
  group: ${{ github.workflow }}-pubmax-mac-${{ github.event_name }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

The group is **per git ref**, not repo-wide. A repo-wide group once queued ancient runs from other branches and blocked every pull request for hours.

Each workflow has its own group so CI, Security CI, browser tests, and RLS do not cancel each other on the same push. A newer pull request head supersedes that pull request's older runs on the shared runner, so rerun the latest workflow run for the current head rather than an older one: a rerun of a superseded run can cancel the current run. Main pushes, the nightly browser suite and manual dispatches never cancel, and the event name in the group keeps the nightly run from queuing behind a main push. The runner should still execute one job at a time; `ci.yml` chains jobs so a single CI run does not parallelize writers.

Job `timeout-minutes` values in `ci.yml`, `e2e.yml`, `rls-session.yml`, and the Playwright jobs in `performance.yml` are set to about **2× the p95** duration observed on the last ~50 self-hosted runs (measured with `gh run list` and `gh api …/jobs`), with floors on the freshness gate (20 minutes) and Coverage (30 minutes). Raise a ceiling only when measured p95 under shared-runner load justifies it; see `perf/AGENTS.md`. `security-ci.yml` uses fixed ceilings (10, 15, and 45 minutes for zizmor, osv-scanner, and Semgrep).

Playwright jobs take `PW_PORT` from `.github/actions/pubmax-playwright-port`. The action uses `PW_PORT` from the runner's `.env` when set; otherwise it hashes `RUNNER_NAME` into one of 90 ports (3100-3990, step 10). Two runner names can still land on the same port, so set an explicit, distinct `PW_PORT` in each runner's `.env` on a shared Mac.

Do **not** use `cache: npm` on `actions/setup-node` or `actions/cache` for `node_modules` on `pubmax-mac` jobs. Restoring those caches from GitHub's cache service can stall ~20 minutes and fail authentication on self-hosted runners; each Mac already keeps npm tarballs under `~/.npm`. Setup Node steps use `timeout-minutes: 5` so a stuck restore fails fast.

`ci.yml` chains the code jobs (`production-build` after lint, unit shards
`max-parallel: 1`, coverage after unit tests). The freshness job runs on its
own: a calendar breach is that job's red mark and does not skip the build,
the unit shards or coverage.

The lint-and-types job runs `npx tsc --noEmit`. Next resolves the TypeScript 6
compiler API at build time. The merge bar `npm run verify` runs
[`npm run typecheck`](../package.json) (TypeScript 7 native); see
[`next.config.mjs`](../next.config.mjs) for why both exist.

### Register or re-register the runner

From [GitHub → repo → Settings → Actions → Runners](https://github.com/Singularityszn/pubmax/settings/actions/runners),
add a new self-hosted runner and follow the `config.sh` instructions. On this
Mac the service runs under **launchd** (runner name `karan-mac-pubmax`).

To reinstall:

1. Stop the service (`./svc.sh stop` in the runner install directory).
2. `./config.sh remove` (or remove the runner in GitHub UI).
3. Download a fresh runner package, `./config.sh --url https://github.com/Singularityszn/pubmax --token <token> --labels self-hosted,macOS,ARM64,pubmax-mac --name karan-mac-pubmax`
4. `./svc.sh install` and `./svc.sh start`.

Secrets and `pull_request_target` / fork triggers are unchanged: only this
repo's branches run workflows.

### Prove the runner

`self-hosted-probe.yml` runs on every PR (one step: `node --version`). Confirm
with:

```sh
gh run list --workflow self-hosted-probe.yml --limit 1
gh api repos/Singularityszn/pubmax/actions/jobs/<job-id> --jq .runner_name
```

Expect one of the `pubmax-mac` runners on the shared Mac, such as `karan-mac-pubmax`.

## Scheduled work split

| Job | Plane |
| --- | --- |
| What's-On bounded + official events refresh | Vercel `GET /api/cron/refresh-whats-on` (primary) |
| What's-On GitHub recovery | `events-refresh.yml` (`workflow_dispatch` only; schedule disabled as duplicate) |
| Weather cache PR | `weather-refresh.yml` on `pubmax-mac` |
| Drink price PR | `drink-price-refresh.yml` on `pubmax-mac` |
| Performance budgets | `performance.yml` on `pubmax-mac` |
| Browser law pins + nightly suite | `e2e.yml` on `pubmax-mac` |

See also `docs/CRON_PLANE_RUNBOOK.md` and `docs/teach.md` (local pre-push hook).
