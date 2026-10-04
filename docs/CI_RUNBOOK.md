# CI runbook

GitHub Actions workflows live under `.github/workflows/`. The merge bar for
application code is still `npm run verify` locally; Actions is the PR status
check layer.

## Self-hosted runners

While GitHub-hosted minutes are billing-locked, every job runs on self-hosted
repo runners on one Mac. There are two labels, and a job's label decides which
macOS user runs it:

| Label | Runners | macOS user | Jobs |
| --- | --- | --- | --- |
| `pubmax-mac` | `karan-mac-pubmax`, `-2`, `-3` | `ghrunner` | Pull request, push, nightly and dispatch jobs that hold no write token and no secret |
| `pubmax-mac-refresh` | `karan-mac-pubmax-refresh` | `ghrefresh` | The jobs with `contents: write` or a repo secret: `drink-price-refresh.yml`, `events-refresh.yml`, `weather-refresh.yml`, `weekly-digest.yml` |

```yaml
runs-on: [self-hosted, pubmax-mac]          # everything else
runs-on: [self-hosted, pubmax-mac-refresh]  # write token or secret
```

`__tests__/ciRunnerIsolation.test.ts` holds that split to the workflows: a job
with a write permission or a secret other than `GITHUB_TOKEN` must use
`pubmax-mac-refresh`, every other job must use `pubmax-mac`, and no workflow a
pull request triggers may use `pubmax-mac-refresh`.

### Dedicated runner users

Each runner job executes code the repository does not fully trust: an
agent-written branch, or any of the roughly 900 packages in the lockfiles. The
week security review (H1) found the three runners running as the Mac's login
user, so that code could read `~/.ssh`, the `gh` token and every key file in
the home directory, and could overwrite the Homebrew binaries later jobs reuse.
The runners now run as two dedicated users instead:

- **`ghrunner`** and **`ghrefresh`** are standard users: not admins, no
  password (`*`), no login shell, hidden from the login window. Nobody signs in
  as them, so they have no login keychain, and they hold no SSH or `gh` state.
- Each user has its own group and a `700` home, and the console user's home is
  `700` too, so no runner user can read the founder's files or the other
  runner's.
- Each runner is a fresh install of the checksum-pinned runner package,
  registered from scratch and started by a LaunchDaemon in
  `/Library/LaunchDaemons/` with `UserName` set. None is a copy of the old
  install, whose binaries the old user could have changed.
- Homebrew stays in `/opt/homebrew`, owned by the console user. The runner
  users can run it and cannot write it.

**Every job's first step after checkout is `Refuse the console user`**
(`scripts/ci/assert-runner-identity.sh`). It fails the job when the job user is
the console user, is an admin, or can list the console user's home. A runner
that drifts back to the login user therefore goes red on its first job.

#### Set up or repair the users

Run as the console (admin) user from a checkout of this repository, never with
`sudo` in front. The script asks for `sudo` itself and uses your own `gh` login
for runner tokens.

```sh
scripts/ci/setup-dedicated-runner-user.sh           # dry run: prints every change
scripts/ci/setup-dedicated-runner-user.sh --apply   # makes them
```

The script is idempotent; a second `--apply` reports each step as done. It
refuses to start while a runner is busy (add `--force` to cancel those jobs).
In order, it:

1. creates `ghrunner` and `ghrefresh` with their groups and homes;
2. runs `chmod 700` on the console user's home;
3. stops each `~/actions-runner-pubmax*` LaunchAgent, unregisters the runner and
   renames its directory with a `.retired-<date>` suffix;
4. downloads `actions-runner-osx-arm64-2.337.0.tar.gz` to
   `/var/tmp/pubmax-runner-2.337.0/` and checks its SHA-256;
5. installs and registers `karan-mac-pubmax`, `-2` and `-3` as `ghrunner`
   (label `pubmax-mac`, `PW_PORT` 3200, 3210 and 3220 unless the old runner set
   one) and `karan-mac-pubmax-refresh` as `ghrefresh` (label
   `pubmax-mac-refresh`);
6. copies `bin/runsvc.sh` to the runner root (the package ships it only under
   `bin/`; the LaunchDaemon runs the root copy), writes one LaunchDaemon per
   runner, bootstraps it and kickstarts it so a service already loaded from an
   earlier apply restarts;
7. proves the result: the identity check passes as both users, neither can read
   `~/.ssh`, `~/.config/gh` or `~/.gitconfig` or the other user's home, no
   `Runner.Listener` runs as the console user, and GitHub shows all four
   runners online within 60 seconds, or the script exits.

Evidence shots used to land in fixed `/tmp` paths owned by the console user. A
runner cannot write those, so delete the leftovers once, as the console user,
before the first job. List them by name: `/tmp/pubmax-verify.lock` and
`/tmp/pubmax-deploy` are live state and must stay.

```sh
rm -rf /tmp/pubmax-account-switch /tmp/pubmax-arrival /tmp/pubmax-avatar-wp3 \
  /tmp/pubmax-founding-members /tmp/pubmax-photo-crop /tmp/pubmax-photo-wall \
  /tmp/pubmax-ui-ux-battle-test /tmp/pubmax-account-menu-1440.png \
  /tmp/pubmax-profile-socials-1440.png /tmp/pubmax-profile-socials-390.png \
  /tmp/pubmax-social-editor-390.png /tmp/social-wp1-verified-feed-390.png
```

Then rerun the checks on any open pull request.

#### Roll back

1. `sudo launchctl bootout system /Library/LaunchDaemons/actions.runner.Singularityszn-pubmax.<name>.plist`
   and delete the plist, for each of the four runners.
2. Remove the four runners in GitHub (Settings, Actions, Runners) or with
   `./config.sh remove --token <token>` as their user.
3. Only if CI must run before the new users are fixed: register a fresh runner
   as the console user with `./config.sh` and `./svc.sh install` in a retired
   directory. That brings H1 back, and every job's identity check fails until
   it is undone. The retired directories hold no valid credential after step 3
   of the setup.
4. The users can stay. `sudo dscl . -delete /Users/ghrunner` and
   `sudo dseditgroup -o delete ghrunner` remove one.

Delete the `.retired-*` directories once the new runners have run for a week.

### Machine prerequisites (Homebrew)

Install once on the runner Mac, as the console user:

```sh
brew install postgresql@16 postgrest node@22 zizmor osv-scanner semgrep # Node must satisfy engines.node in package.json
npx playwright install chromium   # or let CI cache under ~/Library/Caches/ms-playwright
```

Each runner user downloads its own Playwright Chromium into its own
`~/Library/Caches/ms-playwright` on first use.

`security-ci.yml` invokes Homebrew `zizmor`, `osv-scanner`, and `semgrep` directly.
Semgrep uses `/etc/ssl/cert.pem` on macOS when Homebrew certifi paths are missing.
Accepted lockfile findings may be listed in `osv-scanner.toml` with reasons.

PostgreSQL clusters for RLS proofs use the serial harness in
`scripts/rls/postgresHost.mjs` (unique ports/data dirs per job, SysV slot
budget on macOS). Do not use GitHub `services:` Postgres on this runner.

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
merging.

### Parallel jobs on one Mac

Each runner has its own `_work` directory, so three pull request jobs can run
at once. Parallel jobs in one checkout once caused `validate-data` temp-dir
collisions, flaky `venueRoute` reads, and Playwright's
`run-with-restored-next-env` guard (`PUBMAX_TRACKED_OUTPUTS=public/data` for
`NEXT_PUBLIC_SW_VERSION=local` pack stamps). CI, browser tests and RLS still
use:

```yaml
concurrency:
  group: ${{ github.workflow }}-pubmax-mac-${{ github.event_name }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

The group is **per git ref**, not repo-wide. A repo-wide group once queued ancient runs from other branches and blocked every pull request for hours.

Each workflow has its own group so CI, Security CI, browser tests, and RLS do not cancel each other on the same push. A newer pull request head supersedes that pull request's older runs on the shared runner, so rerun the latest workflow run for the current head rather than an older one: a rerun of a superseded run can cancel the current run. Main pushes, the nightly browser suite and manual dispatches never cancel, and the event name in the group keeps the nightly run from queuing behind a main push. Within one CI run, `ci.yml` chains jobs so writers do not run in parallel.

Jobs that start a web server and Chromium share one **job-level** group, `pubmax-mac-browser`, with `cancel-in-progress: false` and `queue: max`: Browser law pins, both nightly full-suite shards, and the two Playwright jobs in `performance.yml`. On 3-4 Oct 2026 several of those jobs ran together on this Mac while local agent work was also on the box. Host load reached about 79, and `e2e/map-surface-history.spec.ts`, `e2e/smoke.spec.ts` and `e2e/visit-reports.spec.ts` timed out. The same specs pass when the machine is quiet. The queue holds up to 100 waiting jobs and runs one at a time, so another pull request waits for a free slot. Lint, typecheck and unit tests stay outside that group and keep running beside the one browser job. A newer head of the same pull request still supersedes that ref's older Browser tests run through the workflow-level group above. Each of those jobs passes `--workers=1`, and `playwright.config.ts` sets the same cap when `CI` is set. Four workers killed the single production server on this rig; two stay up locally; CI stays at one, the cap the law-pin job already used on a quiet machine. Timeouts and retries are unchanged.

Job `timeout-minutes` values in `ci.yml`, `e2e.yml`, `rls-session.yml`, and the Playwright jobs in `performance.yml` are set to about **2× the p95** duration observed on the last ~50 self-hosted runs (measured with `gh run list` and `gh api …/jobs`), with floors on the freshness gate (20 minutes) and Coverage (30 minutes). Raise a ceiling only when measured p95 under shared-runner load justifies it; see `perf/AGENTS.md`. `security-ci.yml` uses fixed ceilings (10, 15, and 45 minutes for zizmor, osv-scanner, and Semgrep).

Playwright jobs take `PW_PORT` from `.github/actions/pubmax-playwright-port`. The action uses `PW_PORT` from the runner's `.env` when set; otherwise it hashes `RUNNER_NAME` into one of 90 ports (3100-3990, step 10). Two runner names can still land on the same port, so set an explicit, distinct `PW_PORT` in each runner's `.env` on a shared Mac.

Do **not** use `cache: npm` on `actions/setup-node` or `actions/cache` for `node_modules` on `pubmax-mac` jobs. Restoring those caches from GitHub's cache service can stall ~20 minutes and fail authentication on self-hosted runners; each runner user already keeps npm tarballs under its own `~/.npm`. Setup Node steps use `timeout-minutes: 5` so a stuck restore fails fast.

`ci.yml` chains the code jobs (`production-build` after lint, unit shards
`max-parallel: 1`, coverage after unit tests). The freshness job runs on its
own: a calendar breach is that job's red mark and does not skip the build,
the unit shards or coverage.

The lint-and-types job runs `npx tsc --noEmit`. Next resolves the TypeScript 6
compiler API at build time. The merge bar `npm run verify` runs
[`npm run typecheck`](../package.json) (TypeScript 7 native); see
[`next.config.mjs`](../next.config.mjs) for why both exist.

### Register a runner by hand

Prefer the setup script. To add one more runner of either kind by hand, as its
user (`sudo -u ghrunner -H bash`), in a new directory under that user's home:

1. Get a token: `gh api -X POST repos/Singularityszn/pubmax/actions/runners/registration-token --jq .token`
   (as the console user).
2. Unpack the pinned runner package from `/var/tmp/pubmax-runner-2.337.0/`.
3. `./config.sh --unattended --url https://github.com/Singularityszn/pubmax --token <token> --name <name> --labels pubmax-mac --work _work`
   (`pubmax-mac-refresh` for a refresh runner).
4. Write a LaunchDaemon with `UserName` set, like the ones the script writes.
   Never use `./svc.sh install`: it installs a LaunchAgent for whoever runs it.

Secrets and `pull_request_target` / fork triggers are unchanged: only this
repo's branches run workflows.

### Prove the runner

`self-hosted-probe.yml` is `workflow_dispatch` only. It runs the identity check
and `node --version` on a `pubmax-mac` runner:

```sh
gh workflow run self-hosted-probe.yml
gh run list --workflow self-hosted-probe.yml --limit 1
gh api repos/Singularityszn/pubmax/actions/jobs/<job-id> --jq .runner_name
```

Expect one of `karan-mac-pubmax`, `-2` or `-3`, and a passing `Refuse the
console user` step.

## Scheduled work split

| Job | Plane |
| --- | --- |
| What's-On bounded + official events refresh | Vercel `GET /api/cron/refresh-whats-on` (primary) |
| What's-On GitHub recovery | `events-refresh.yml` (`workflow_dispatch` only; schedule disabled as duplicate) |
| Weather cache PR | `weather-refresh.yml` on `pubmax-mac-refresh` |
| Drink price PR | `drink-price-refresh.yml` on `pubmax-mac-refresh` |
| Performance budgets | `performance.yml` on `pubmax-mac` |
| Browser law pins + nightly suite | `e2e.yml` on `pubmax-mac` |

See also `docs/CRON_PLANE_RUNBOOK.md` and `docs/teach.md` (local pre-push hook).
