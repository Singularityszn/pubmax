# Offline plan cache: Pint Drop correction

## Before

At `14422a97f`, `isPlanPath` accepted both `/plan/<id>` and `/p/<id>`. It also
accepted nested plan pages such as `/plan/<id>/recap`. The service worker used
that rule to write navigation HTML to `PLAN_CACHE` and to return it offline.
Activation copied every legacy plan-cache entry into the current cache without
checking its route.

I added regression tests before changing the worker. This command failed in
four tests, with 40 passing:

```sh
npx vitest run __tests__/swPlanCache.test.ts __tests__/serviceWorkerCache.test.ts
```

The failures showed `/p/drop1` returned cached Pint Drop HTML, path matching
admitted `/p/drop1`, and activation retained or copied Pint Drop and recap HTML.

## After

`PLAN_CACHE` admits only same-origin `/plan/<id>` navigation HTML. The helper
rejects Pint Drop links and nested plan routes at both write and read time.
Activation deletes ineligible entries in the current cache and in each legacy
plan cache before it can migrate an entry. A valid `/plan/<id>` preview still
migrates and opens offline. Member details remain behind live, capability-gated
API reads; the plan page renders only a privacy-safe preview in HTML.

| Case | Before | After |
| --- | --- | --- |
| Network `/p/drop1` navigation | Stored in `PLAN_CACHE` | Excluded |
| Offline `/p/drop1` with an old `PLAN_CACHE` entry | Returned Pint Drop HTML | Does not return the plan-cache entry |
| Upgrade with `/p` in current or legacy `PLAN_CACHE` | Retained or copied | Entry deleted |
| Nested `/plan/night1/recap` | Eligible for plan cache | Excluded and purged |
| Offline `/plan/offline-night` | Returned cached plan | Still returns cached preview |
| Upgrade with plan-cache write rejection | Kept old plan for offline use | Still keeps old plan; removes old `/p` entry |

## Verification

| Command | Result |
| --- | --- |
| Focused Vitest command above, after fix | 45 passed, 0 failed |
| `npm run typecheck` | Passed |
| `npx eslint public/sw.js public/sw-plan-cache.js __tests__/swPlanCache.test.ts __tests__/serviceWorkerCache.test.ts` | Passed, no warnings |
| `DEPLOYMENT_VERSION=local NEXT_DIST_DIR=.next-prod npm run build` | Passed |
| `DEPLOYMENT_VERSION=local npm run verify` | Stopped in coverage: 17,941 passed, 1 failed, 5 skipped. `__tests__/vercelIgnoreCoverage.test.ts` found a local `artifacts` directory of 1,259 MB absent from `.vercelignore`. Later verify stages did not run. |

The focused tests evaluate the shipped service worker and imported plan helper
against an in-memory Cache Storage harness. No browser upgrade or deployment
was run in this pass. Build-generated venue shard changes were restored from
the clean iteration-start state.

## Shell-cache correction

The current worker wrote only four shell URLs, but activation copied any old
shell-cache entry. Before the correction, an offline `/p/current-drop`
navigation returned cached Pint Drop HTML with status 200. Activation also
copied `/p/legacy-drop` into the current shell cache. Two new tests in
`__tests__/serviceWorkerCache.test.ts` reproduced those failures before the
worker changed:

```text
npx vitest run __tests__/serviceWorkerCache.test.ts -t 'shell cache'
2 failed, 33 skipped
offline /p: expected 503, received 200
activation: current shell cache contained both /p entries
```

The worker now admits and migrates only same-origin shell URLs from its fixed
list: `/`, `/map`, `/tonight`, and `/offline.html`. Activation deletes other
entries in both current and legacy shell caches, including previously saved
Pint Drops. Shell-cache lookup rejects `/p/<id>` even before activation runs.
The offline ladder still opens `/map` from a legacy cache when a current-cache
write fails. A valid `/plan/<id>` preview still opens through the separate
plan cache.

| Case | Before | After |
| --- | --- | --- |
| Offline `/p/<id>` in current or legacy shell cache | Returned stored Pint Drop HTML | Returns no Pint Drop HTML |
| Upgrade with `/p` in current or legacy shell cache | Retained or copied entry | Deletes entry |
| Network `/p/<id>` navigation | Not admitted by current shell or plan writers | Still not admitted |
| Offline `/map` with legacy shell cache | Returned map shell | Still returns map shell |
| Offline `/plan/<id>` | Returned plan preview | Still returns plan preview |

## Final verification

The local QA browser install lives under Git-ignored `artifacts/`. The deploy
upload fence caught it as 1,259 MB of unlisted input. `.vercelignore` now
excludes `artifacts/` and the Git-ignored `.gnhf/` run directory, and its test
requires both exclusions. No evidence files were removed.

| Command | Result |
| --- | --- |
| Focused cache and deploy-ignore tests | 51 passed, 0 failed |
| `npm run typecheck` | Passed |
| Targeted ESLint for changed code and tests | Passed, no warnings |
| `DEPLOYMENT_VERSION=local npm run verify` | Passed; coverage: 17,945 passed, 5 skipped; lint: 0 errors, 74 warnings |
| `DEPLOYMENT_VERSION=local NEXT_DIST_DIR=.next-prod npm run build` | Passed |

The cache tests execute the shipped service worker and imported plan helper
against an in-memory Cache Storage harness. No browser upgrade or deployment
was run. Build-generated venue shard changes were restored after validation.
