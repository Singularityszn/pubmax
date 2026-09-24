# CI runbook

GitHub Actions workflows live under `.github/workflows/`. The merge bar for
application code is still `npm run verify` locally; Actions is the PR status
check layer.

## Self-hosted runner (`pubmax-mac`)

While GitHub-hosted minutes are billing-locked, PR and scheduled jobs run on the
repo runner **`karan-mac-pubmax`** with labels `self-hosted`, `macOS`, `ARM64`,
and **`pubmax-mac`**. Workflows use:

```yaml
runs-on: [self-hosted, pubmax-mac]
```

### Machine prerequisites (Homebrew)

Install once on the runner Mac:

```sh
brew install postgresql@16 postgrest node@22 # or another Node 22 install
npx playwright install chromium   # or let CI cache under ~/Library/Caches/ms-playwright
```

PostgreSQL clusters for RLS proofs use the serial harness in
`scripts/rls/postgresHost.mjs` (unique ports/data dirs per job, SysV slot
budget on macOS). Do not use GitHub `services:` Postgres on this runner.

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

Expect `karan-mac-pubmax`.

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
