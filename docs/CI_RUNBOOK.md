# CI runbook

GitHub Actions workflows live under `.github/workflows/`. CI owns the full
suite. A merge needs CI green on the latest commit. Before you push, run
`npm run verify:no-mistakes:changed`.

The main ruleset requires five green summary checks, one per pull-request
workflow. The GitHub merge queue runs them again on the commit that will land.
See [The required checks and the merge queue](#the-required-checks-and-the-merge-queue).

## The required checks and the merge queue

Before 7 Nov 2026 GitHub required no check on `main`. Only 19 of the last 43
merged pull requests had green CI and green browser tests when they merged,
and `main` broke twice on 6 Nov. For about 9 hours every pull request then
failed its browser tests. So a merge now needs five green checks:

| Required check | Workflow | What it is |
| --- | --- | --- |
| `CI check` | `ci.yml` | The summary job. It needs every other job in the workflow. |
| `Browser tests check` | `e2e.yml` | The summary job. It needs `Merge queue proof`, the law pins, `Change scope` and the three layout pins. |
| `RLS session check` | `rls-session.yml` | The summary job. It needs `Merge queue proof` and the RLS session job. |
| `Security CI check` | `security-ci.yml` | The summary job. It needs `Merge queue proof` and all four security jobs. |
| `Freshness check` | `freshness.yml` | The summary job. It needs change detection and the freshness job. |

A summary job uses `always()` to report even when a job it needs failed or
was cancelled. The browser workflow excludes unrelated label events, as
described below. A summary fails when a job it needs failed or was cancelled.
A job that its own `if` skipped passes, for example
`Review scope` in the merge queue or a layout pin for a change with no screen
code. The ruleset names only these checks, so a job can be added, split or
resharded with no settings change. A new pull-request job must be added to its
summary's `needs`. `__tests__/ciSummaryCheck.test.ts` holds each summary to
every pull-request job in its workflow and runs its script.

The browser summary excludes the two full-suite jobs and `nightly-failure-issue`.
These jobs never run for pull requests or the merge queue.

The five workflows also listen for `merge_group`. The queue tests each pull
request on top of `main` and the pull requests ahead of it, so a change that
is green alone but red beside another one never reaches `main`. The general change classifiers read `merge_group` as `code`, so those Linux jobs run in full.
Freshness checks the queue diff and runs its data checks only when data changed.

The macOS layout pins run in the merge queue. Ordinary pull request pushes
and `main` pushes skip them (captain, 9 Nov 2026). This replaces the 7 Nov 2026
choice to leave them on each pull request push and each `main` push. The queue
settings assume three Mac places. A pull request waited about an hour for one,
and each push used about 42 Mac minutes. In the queue they test the exact commit
that lands, which before ran them only after it was on `main`.
`Browser tests check` still needs them, so a layout failure ejects its queue
entry. To request an early run, add the `layout-pins` label to a pull request
from this repository. The label cancels the older browser run and starts a
new one. Each later push runs the pins again while the label stays.
On labelled pull requests, the pins skip changes with no screen code unless
classification fails.
See [What a pull request runs](#what-a-pull-request-runs) for the classifier.
Other label events skip every job and use separate,
non-cancelling runs. Their check names start with `Not run for label - `, so
they cannot replace the real browser checks.
Each queue entry starts three layout jobs. With three available Mac places,
the jobs can run together. See [Self-hosted Mac runners](#self-hosted-mac-runners)
for runner setup.

The queue moves `main` to the exact commit it tested. In
`ci.yml`, `e2e.yml`, `rls-session.yml` and
`security-ci.yml`, the `Merge queue proof` job runs on a push only. It looks
for a green `merge_group` run of the same workflow for the pushed commit. When
it finds one, jobs that ran in the queue are skipped, except `Production build`.
The queue also runs a production build. The main push keeps `Production build`
only to save the Next.js build cache for later pull requests. GitHub scopes
caches to their ref. Pull requests can restore caches from their own ref and
the base branch, but cannot restore caches from temporary merge queue refs.
`Review scope` still runs because the queue does not run it. The layout pins
run in the queue and skip every `main` push. When the proof finds no run, or
the API call fails, the proof-gated jobs run.
`__tests__/ciSummaryCheck.test.ts` holds which jobs run for each event.

On pull requests and merge groups, `Coverage` runs after successful unit
shards even though `Merge queue proof` is skipped.

Security CI blocks merging through `Security CI check` and runs in the queue.
See [Security CI is blocking](#security-ci-is-blocking). A retried test still fails its gate:
`scripts/assert-playwright-gate.mjs` counts a pass on retry as a failure, so
fix a flaky spec rather than re-running it (captain, 7 Nov 2026).

### The ruleset

The ruleset is a repository setting, not a file. A repository admin creates
it once, after the pull request that adds the summary checks has merged, so
that every pull request can report them. The merge queue is free for a public
repository owned by an organisation. No paid feature is used.

Settings:

| Setting | Value |
| --- | --- |
| Name | `main merge gate` |
| Target | the default branch (`~DEFAULT_BRANCH`, which is `main`) |
| Enforcement | active |
| Bypass list | empty. In an emergency an admin turns the ruleset off and back on, and says so. |
| Required status checks | the five summaries above, each from GitHub Actions (integration 15368) |
| Require branches to be up to date | off. The merge queue tests the up-to-date result. |
| Merge queue | on |
| Merge method | squash |
| Build concurrency | 1 queue entry at a time. See the layout-job capacity above (captain, 9 Nov 2026). |
| Group size | at least 1, at most 5 |
| Wait for a minimum group size | 5 minutes |
| Grouping strategy | all entries must pass (`ALLGREEN`) |
| Status check timeout | 120 minutes. An entry can wait for the Mac places while the nightly full suite holds them (captain, 9 Nov 2026). |

Create it with `gh`:

```sh
gh api --method POST repos/Singularityszn/pubmax/rulesets --input - <<'JSON'
{
  "name": "main merge gate",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "CI check", "integration_id": 15368 },
          { "context": "Browser tests check", "integration_id": 15368 },
          { "context": "RLS session check", "integration_id": 15368 },
          { "context": "Security CI check", "integration_id": 15368 },
          { "context": "Freshness check", "integration_id": 15368 }
        ]
      }
    },
    {
      "type": "merge_queue",
      "parameters": {
        "merge_method": "SQUASH",
        "grouping_strategy": "ALLGREEN",
        "max_entries_to_build": 1,
        "min_entries_to_merge": 1,
        "max_entries_to_merge": 5,
        "min_entries_to_merge_wait_minutes": 5,
        "check_response_timeout_minutes": 120
      }
    }
  ]
}
JSON
```

Read it back with `gh api repos/Singularityszn/pubmax/rulesets`. A merge then
goes through the queue: `gh pr merge <number> --squash` adds a green pull
request to it, or use the "Merge when ready" button.

## Runners

Jobs use GitHub-hosted `ubuntu-latest` by default, including Browser law
pins. The `MACOS_JOBS` list in `__tests__/ciRunnerIsolation.test.ts` owns the
macOS exceptions and their reasons. They run on the self-hosted `pubmax-mac` pool
(see "Self-hosted Mac runners" below):

- The layout pins and the two nightly full-suite jobs. Their specs were proved on
  macOS glyph widths. Both use the same self-hosted webfonts, but Linux
  Chromium draws some lines a few pixels wider. On 16 Oct 2026 four layout
  specs failed on `ubuntu-latest` (for example 7px short at 320px), and the
  full suite failed 19 more tests than the macOS nightly.
- The two `performance.yml` jobs. Their route budgets were measured on macOS.
- `prod-smoke.yml`. It runs once per production deploy.

The `LINUX_PINNED_JOBS` list in the same test owns the hosted jobs that pin an
Ubuntu image. The Effective RLS job runs on `ubuntu-24.04` because it installs
`postgresql-16` from the Ubuntu archive, and `ubuntu-26.04` does not carry it.

GitHub's free plan runs about 20 hosted Linux jobs at once. Hosted macOS
jobs waited a long time in GitHub's queue, so the macOS jobs moved to the
`pubmax-mac` pool (captain, 6 Nov 2026). See
[The required checks and the merge queue](#the-required-checks-and-the-merge-queue)
for layout-job scheduling and capacity. The performance sweep once failed to
measure itself on a private repository's 2 vCPU runner; that is why it is
not on the pull-request path.

```yaml
# default, including Browser law pins
runs-on: ubuntu-latest
# the MACOS_JOBS list only
runs-on: pubmax-mac
# the LINUX_PINNED_JOBS list only, with its own image
runs-on: ubuntu-24.04
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
  system packages or `sudo`. See
  [Self-hosted Mac runners](#self-hosted-mac-runners) for browser cache setup.
- **zizmor, osv-scanner, gitleaks and Semgrep** in
  [`security-ci.yml`](../.github/workflows/security-ci.yml), which owns their
  versions and checksum pins.

PostgREST and the Security CI tools (zizmor, osv-scanner and gitleaks) install
through [`scripts/ci/install-pinned-tool.sh`](../scripts/ci/install-pinned-tool.sh).
The workflow step names the pins: version, release URL, sha256 and fallback.
The script selects an installation source in this order:

1. The cached release download. Each `actions/cache` step targets one verified
   asset file under `~/.cache/pubmax-tools`, rather than the directory.
   The file name and cache key include the tool name, version and sha256.
   The script uses the file only when its sha256 still matches.
2. The release download, with `curl --retry 8 --retry-delay 15
   --retry-max-time 300 --retry-all-errors --connect-timeout 30`. The script
   keeps it only when its sha256 matches.
3. A source that is not a GitHub release. zizmor installs from its PyPI wheel
   with `pip --require-hashes` and the wheel's sha256. osv-scanner and gitleaks
   build with `go install` at the pinned version through `proxy.golang.org`,
   checked against `sum.golang.org`, and the script then checks the version the
   binary was built from. PostgREST copies `/bin/postgrest` from a digest-pinned
   Docker Hub image with `--platform linux/amd64` for both pull and create.
   The script removes the container and checks the copied binary's sha256
   before installation. The step logs a warning when it uses a fallback.

If a download fails or its checksum differs, the script removes the unverified
file. A fallback installation leaves no release asset for `actions/cache` to save.
The retry window is bounded. Installation can still fail if all sources fail.

The PostgreSQL packages in [`rls-session.yml`](../.github/workflows/rls-session.yml)
install through `apt-get -o Acquire::Retries=5`.

[`ciToolDownloadRetries.test.ts`](../__tests__/ciToolDownloadRetries.test.ts)
executes the Security CI and PostgREST installation steps with their own pinned
environments and the real installer. It checks the download arguments and confirms that
fallback installations leave no release asset to cache.
It also runs the installer through each source, a damaged cache and a checksum
mismatch, with `curl`, `python3`, `go`, `docker` and `sudo` replaced by recorders.
Download retries do not change [the test retry policy](#the-required-checks-and-the-merge-queue).

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
  GitHub's cache. After `npm ci`, `.github/actions/pubmax-playwright-browsers`
  restores the browser folder with a key containing the runner OS,
  architecture and installed Playwright version. It refuses an unset browser
  path or one outside `RUNNER_TEMP`. On a cache hit, `Install Chromium` skips
  the download. On a miss, it downloads Chromium and the cache action saves
  the folder when the job succeeds.
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
repository and add the `layout-pins` label to run the pins.

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

### Security CI is blocking

`security-ci.yml` runs zizmor online over `.github/`, osv-scanner over every lockfile, Semgrep, and gitleaks.
It runs on pull requests, merge groups, pushes to `main`, Mondays, and manual dispatches.
The main ruleset requires `Security CI check`, which fails if any security job fails or is cancelled.
zizmor uses `github.token`, the job token, rather than a repository secret.

gitleaks scans a different range for each event:

| Event | Range |
| --- | --- |
| Pull request or merge group | The complete history reachable from the checkout (`HEAD`). |
| Push to `main` | Only the pushed commits (`before..after`), including after a force push. When the previous head is all zeros or missing from the clone, it scans the complete history of the new head. |
| Weekly run and manual dispatch | Every ref (`--all`), so a secret on any branch is still found. |

A push to `main` once scanned every ref. A finding on an unmerged branch then
turned `main` red on every push, so the colour of `main` meant nothing. The
allowlists and their reasons are in `.gitleaks.toml`. One exact historical
finding that fits no allowlist shape goes in `.gitleaksignore`.

### Timeouts and job shape

Job `timeout-minutes` values in `ci.yml`, `e2e.yml`, `freshness.yml`, `rls-session.yml`, and the Playwright jobs in `performance.yml` stay at the ceilings already set for those jobs (about 2× the p95 measured on the previous runners), with floors on the freshness gate (20 minutes) and Coverage (30 minutes). Each summary check stops after 5 minutes, because it only reads results. Do not raise one to hide a slow hosted run; see `perf/AGENTS.md`. `security-ci.yml` uses fixed ceilings (10, 15, and 45 minutes for zizmor, osv-scanner, and Semgrep).

Browser law pins keep `--workers=1`. [Self-hosted Mac runners](#self-hosted-mac-runners)
defines the worker limit for Mac jobs. [The required checks and the merge queue](#the-required-checks-and-the-merge-queue)
and [What a pull request runs](#what-a-pull-request-runs) define when the
layout shards run.

The three layout shards split their specs by measured time, not by count
(captain, 9 Nov 2026). Playwright's `--shard` cut the list into equal test
counts, and the slow map specs sat together in the third shard: it ran 11 to
18 minutes of tests while the other two ran 5 to 11. Each shard passes the
whole spec list to `scripts/ci/layout-pin-shard.mjs`, which picks its share
from `scripts/ci/layout-pin-durations.json` with the unit shards' rule (longest
spec first, each to the lightest shard). The recorded weights assign about
9 minutes of tests to each shard. A spec the durations list does not know
weighs the median.

Refresh the weights from one-worker macOS Playwright JSON reports:
`npm run ci:layout-pin-durations -- <report.json> [more reports...]`.
The updater sums each spec's result durations within each report, then takes
the median of those report totals. A partial rerun therefore does not add
another run's cost to a spec's weight. Only existing entries are updated.
Specs absent from every supplied report keep their previous weights.

The nightly full suite separates plain Chromium shards from the WebGL and
keyless projects. The [browser workflow](../.github/workflows/e2e.yml) owns
the shard matrix and project lists. Each Chromium shard builds one server.
`Full browser suite (WebGL and keyless)` builds both the normal and keyless
servers. These jobs use the worker limit defined above.
A dispatch skips the layout-pin jobs to avoid duplicate runs on the Mac pool.
[The nightly full suite](#the-nightly-full-suite) owns dispatch timing and
quarantine exclusions.

Each workflow has its own concurrency group. A newer pull request head supersedes that pull request's older runs of the same workflow, so rerun the latest workflow run for the current head. The nightly browser suite, manual dispatches and merge queue runs never cancel: each one gets a group of its own (`run-<run_id>`). Main pushes of `ci.yml`, `rls-session.yml` and `security-ci.yml` also get a group of their own. GitHub keeps only one waiting run per group, so the old per-ref group dropped waiting main pushes. There is no repo-wide group and no shared browser queue.

Main pushes of Browser tests (`e2e.yml`) share one group, `main-push` (owner decision, 19 Oct 2026). The run in progress always finishes. Only the newest push waits behind it, and GitHub cancels an older waiting push. The group was set when each main push started three layout-pin jobs. Since 9 Nov 2026 a main push starts no Mac job. The newest main commit holds every older one, so main is still tested. When a main run fails, it can cover several merges: read the merges since the last green main run. The nightly full suite still runs on its own group.

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
suite once, not once in the shards and again for coverage.

### The nightly full suite

The full suite runs only on a dispatch, never on a pull request or a push to
`main`. It has no `schedule`. GitHub started the old 03:17 UTC schedule six to
eight hours late (29 Oct to 7 Nov 2026), and the 20:17 UTC schedule at 23:38
and 23:43 UTC (7 and 8 Nov 2026), while pull requests still came in. A pull
request waited p50 79 minutes for a Mac place while the full suite ran,
against 27 minutes when it did not (6 to 9 Nov 2026).

A launchd agent on the Mac Studio starts the nightly at 05:00 Mac local time
(Europe/London: 05:00 UTC in winter, 04:00 UTC in summer). It runs
`gh workflow run e2e.yml --repo Singularityszn/pubmax --ref main` with the
Studio's `gh` login, and logs to `~/Library/Logs/pubmax-nightly-browser-suite.log`.
launchd runs a missed time after the Mac wakes, so the agent dispatches nothing
at or after 07:00 UTC. Install it, or reinstall it after a change to the file:

```sh
cp scripts/ci/com.pubmax.nightly-browser-suite.plist ~/Library/LaunchAgents/
launchctl bootout "gui/$(id -u)/com.pubmax.nightly-browser-suite" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.pubmax.nightly-browser-suite.plist
```

`launchctl kickstart "gui/$(id -u)/com.pubmax.nightly-browser-suite"` runs it
once now. Before 07:00 UTC that dispatches a full run.

When a full-suite job of a dispatch on `main` fails or is cancelled, the
`nightly-failure-issue` job reports the result. This includes timeout cancellations.
A dispatch on any other branch is a check of that branch and reports nothing.
The job comments on an open issue with the exact title "Nightly full browser suite failed".
If no open issue has that exact title, the job creates one.
The job uses the run's own `GITHUB_TOKEN` and needs no configured secret.
Close the issue when the nightly is green again.

`e2e/full-suite-quarantine.txt` lists the known-red tests that both full-suite
jobs exclude with `--test-list-invert`. Each block needs a comment with a
`Singularityszn/pubmax` tracking issue link. A blank line ends the block.
`npm run gate:e2e-skips` rejects a test line without that link or an existing spec.
Delete the lines in the same pull request that fixes the test, then close the issue.
The law-pin and layout-pin jobs do not read the list. When eligible, these jobs
still run every test they name.

A failure outside the list makes the nightly red. The screenshot failure in
[#2630](https://github.com/Singularityszn/pubmax/issues/2630) can affect a different
test each night, so the quarantine cannot guarantee a green run.

### The freshness gate

The freshness gate measures how old the data is, not the code a pull request
changes. On every pull request it went red when a dataset passed its age
budget, whatever the pull request held: 11 pull request failures and 22 `main`
failures from 3 to 7 Nov 2026. So it left `ci.yml` for its own workflow,
`freshness.yml` (captain, 7 Nov 2026). It runs:

- every day at 07:47 UTC, and by hand (`workflow_dispatch`);
- on a pull request or merge group that changes a file under `data/` or `public/data/`;
- before every production release, as a preflight of `npm run release:prod`.
  A red gate refuses the release before anything is uploaded.

The workflow starts on every pull request and merge group so the required `Freshness check` always reports.
A Linux job detects data changes before the freshness job starts.
For pull requests, it compares the merge commit with its first parent and fetches two commits.
For merge groups, it fetches and compares `base_sha` and `head_sha` from the event.
Scheduled runs and manual dispatches always run the freshness job.
The freshness job also runs if detection fails.
A skipped freshness job passes its summary, but a failed detection or freshness job fails the summary.
There is no push trigger or workflow-level path filter.
A scheduled failure posts through `alert-on-failure.yml`.
`npm run verify` still runs `npm run check:freshness` locally.

The job installs Node without the npm cache or the application dependencies.
Both scripts use only Node built-ins. The first checks committed candidate
artifacts. The second reads production store observations through
`https://pubmaxxing.com/api/freshness`. `FRESHNESS_GATE_COMMANDS` in
`scripts/lib/releaseProduction.mjs` is the one list of the two commands, and
`__tests__/ciSummaryCheck.test.ts` checks both commands independently in the workflow and release preflight.

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

The lint-and-types job and `npm run verify` both run
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

`next build` also type-checks `tsconfig.build.json` with TypeScript 6. That took 3.0 of the 4:16 `Build` step in run 41450554289, and the `Typecheck (TypeScript 6)` job already checks `tsconfig.json`, which covers every file `tsconfig.build.json` does, with the same compiler options. So the CI `Build` step sets `PUBMAX_CI_SKIP_BUILD_TYPECHECK=1`, and `next.config.mjs` then sets `typescript.ignoreBuildErrors`, which skips the build's check entirely (captain, 2 Nov 2026). `next.config.mjs` ignores the variable when `VERCEL` is set, because a Vercel dashboard variable reaches Vercel builds too, so a deploy build always type-checks. A type error fails `Typecheck (TypeScript 6)` and its summary, `CI check`. See [The required checks and the merge queue](#the-required-checks-and-the-merge-queue) for merge enforcement. Measured on a dev container: the whole `next build` took 377 seconds with the check and 83 seconds without it. `__tests__/ciReleaseGateWorkflow.test.ts` holds the variable, the wider check, the tsconfig coverage and the Vercel refusal. The browser jobs in `e2e.yml` and `performance.yml` build the app too, through the Playwright web server, so their build steps set the same variable: on a macOS runner the build's own type check took more than 6 minutes and pushed the web server past its 10 minute start limit on pull request 2468. `__tests__/e2eWorkflow.test.ts` holds that.

### What a pull request runs

A pull request that changes only docs or only data skips the heavy jobs (owner decision, 16 Oct 2026). Each heavy job's second step, `Classify the change`, diffs the pull request's merge commit against its first parent and names the scope:

- **docs**: every changed file is under `docs/` or ends in `.md`.
- **data**: every changed file is docs or data, and at least one is data (`data/**/*.json` or anything under `public/data/`).
- **code**: anything else. That includes an empty diff, any other file under `data/`, every `.github/` file that is not Markdown, and every event that is not a pull request. A push to `main` always gets the `code` scope. The [browser job schedule](#timeouts-and-job-shape) controls which browser jobs run.

The diff runs with `--no-renames`, so a file moved counts under both its old and its new path. A pull request that moves `lib/` code into `docs/` reads as code, not docs.

The job still starts and reports. Only its steps are skipped, so it shows green under its real name. A matrix job skipped at the job level reports one check under its unexpanded name, `Unit tests (${{ matrix.shard }}/3)`, and a required `Unit tests (1/3)` would then wait for ever. These heavy jobs therefore skip individual steps. Since 7 Nov 2026 the ruleset requires only the summary checks, which accept a skipped job, so this limit no longer binds, but these heavy jobs retain their step gates. The freshness job skips whole when no data changed. The gated checkouts fetch two commits, the merge and its base. Every copy of the classifier is identical, and `__tests__/ciChangeScope.test.ts` holds them to that and runs them.

The macOS layout pins also skip whole to avoid holding a runner (owner decision, 17 Oct 2026). A job that starts only to skip its steps still holds a runner. Before the Mac pool migration, three layout shards per pull request filled the hosted macOS queue. Docs-only pull requests waited up to 53 minutes for a job that then ran for 1 minute. In `e2e.yml` one Linux job, `Change scope`, runs the classifiers. `Browser layout pins (1/3)`, `(2/3)` and `(3/3)` are three named jobs that need it. When `Change scope` succeeds and `Classify the layout change` outputs `none`, GitHub skips all three jobs without starting a Mac job. If `Change scope` fails, the layout jobs run for events eligible under [The required checks and the merge queue](#the-required-checks-and-the-merge-queue). This preserves layout checks when classification fails, because a skipped job passes its summary. The three jobs share one step list through a YAML anchor and differ only in `LAYOUT_SHARD`.

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
| CI / CI check (required) | runs | runs | runs |
| CI / Data validation | runs | runs | runs |
| Browser tests / law pins | green, steps skipped | green, steps skipped | runs |
| Browser tests / Change scope | runs (Linux, classifier only) | runs | runs |
| Browser tests / layout pins (1-3/3) | skipped, no Mac place | skipped, no Mac place | follows the [layout-job schedule](#the-required-checks-and-the-merge-queue) and layout scope above |
| Browser tests / full suite | not run on pull requests (nightly and dispatch only) | same | same |
| Browser tests / nightly failure report | not run on pull requests (nightly dispatch on `main` only) | same | same |
| Browser tests / Browser tests check (required) | runs | runs | runs |
| RLS session tests | green, steps skipped | green, steps skipped | runs |
| RLS session tests / RLS session check (required) | runs | runs | runs |
| Security CI (zizmor, osv-scanner, Semgrep, gitleaks) | runs | runs | runs |
| Security CI / Security CI check (required) | runs | runs | runs |
| Freshness release gate / change detection | runs | runs | runs |
| Freshness release gate / data checks | runs only if a Markdown file under `data/` or `public/data/` changed | runs | runs only if a file under `data/` or `public/data/` changed |
| Freshness release gate / Freshness check (required) | runs | runs | runs |

For unrelated label events, the [browser workflow exception](#the-required-checks-and-the-merge-queue) overrides the Browser tests rows in this table.

The named-test step covers fences that read the very file a pull request changed, such as an `AGENTS.md`, a pack or `data/freshness_registry.json`. It selects every `__tests__/*.test.ts(x)` file that names a changed file by path or by file name. A unit test that reads data without naming the file waits until the merge queue, which runs the full unit suite. For docs-only or data-only changes, browser pins follow the table above. The [browser job schedule](#timeouts-and-job-shape) controls browser coverage.

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
| Freshness release gate, daily | `freshness.yml` |
| Production uptime, every five minutes | `uptime.yml` (alerts through `alert-on-failure.yml`) |
| Browser law pins, layout pins + nightly suite | `e2e.yml` |

The weather refresh reuses `weather-cache/latest` and its open review PR.
Later runs add refreshed snapshots to that PR instead of creating daily branches.
The captain approved this PR route to land the refresh on `main` through the
required checks. The job never writes directly to `main`. An unchanged snapshot
causes no commit or push.

Weather publication uses an explicit Git push lease against the fetched branch
commit, or an empty lease when the branch does not exist. If the remote branch
changes, appears, or disappears before publication, the push fails before PR
handling. This prevents a concurrent merge and branch deletion from recreating
the old branch history. `__tests__/weatherRefresh.test.ts` covers these races.

If the repository does not let GitHub Actions open pull requests, the weather
and What's-On refreshes still push their review branch. They log the branch link
as a warning and the run stays green. Open that PR by hand. The setting is in
Settings, Actions, General: "Allow GitHub Actions to create and approve pull
requests". Only the captain changes it.

See also `docs/CRON_PLANE_RUNBOOK.md` and `docs/teach.md` (local pre-push hook).
