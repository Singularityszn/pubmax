# Refined v0 baseline and Places check

Checked on 29 September 2026 in `codex/refined-v0` at local commit `b49b5850`. GitHub freshness remains unverified because this iteration did not fetch the remote. No production service or live account was used.

## Baseline

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Exit 0. Installed 722 packages from the lockfile. |
| `DEPLOYMENT_VERSION=local npm run verify` | Exit 0. Data validation passed for 21 datasets; lint had 0 errors and 74 warnings; typecheck and deadcode passed. Coverage run had 1,695 passing files, 1 skipped file, 17,939 passing tests and 5 skipped tests. PostgreSQL RLS checks, E2E skip gate, freshness gate and resilient audit completed. Audit found no high or critical vulnerabilities. |
| `NEXT_DIST_DIR=.next-prod DEPLOYMENT_VERSION=local PUBMAX_TRACKED_OUTPUTS=public/data node scripts/run-with-restored-next-env.mjs npm run build` | Exit 0. Next.js 16.3.6 compiled and generated 539 static pages. The wrapper restored generated tracked files after the build. |

Freshness check reported `area_news` aged 768 hours against its 504-hour budget. It was advisory. Night signal candidates, weather and what's on could not be aged without store credentials. The verify result does not establish those feeds are current.

## Places journey

Served `.next-prod` on dedicated port 43821 with keyless in-memory state and a test-only Plan signing secret. Chromium came from a browser directory under `artifacts/`, separate from the shared Playwright cache.

`PLAYWRIGHT_BROWSERS_PATH=artifacts/playwright-browsers PW_PORT=43821 PW_SKIP_WEBSERVER=1 npx playwright test e2e/places-tab.spec.ts --project=chromium --workers=1` passed all 6 checks. The suite covered city choice and persistence through Map, Out and Near at 390px, missing-city and London states, the 320px tab bar, and the 1440px desktop navigation.

A separate 768px Chromium check returned HTTP 200, found 12 city links and measured 0px horizontal overflow. I inspected full-page captures at [390px](places-390.png), [768px](places-768.png) and [1440px](places-1440.png). No clear layout defect appeared in this Places pass. The browser test rewrote tracked screenshots; I copied these three captures into this proof folder and restored the test-owned files.

## Remaining scope

This slice found no reproducible Places defect, so it changed no product code. Map, Plan, account, price accuracy, security, cache and performance journeys still need browser review. Package freshness and installed skill provenance remain unreviewed. Latest pushed code, open PRs and remote head remain unverified until GitHub access returns. No commit, push, migration or deployment occurred.
