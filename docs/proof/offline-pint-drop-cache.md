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

## Remaining shell-cache work

The current worker writes only four fixed shell URLs, but `migrateCacheFamily`
still copies any old `SHELL_CACHE` entry. Its exact-path offline lookup can then
return a `/p/<id>` entry from a current or legacy shell cache. This pass did not
change that path. The full stop condition needs a shell-cache purge and lookup
guard, with a regression test for an old shell cache entry.
