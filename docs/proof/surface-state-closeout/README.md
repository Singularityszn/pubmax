# Surface state fixes

Base: `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.
Branch: `codex/surface-state-closeout`.
Worktree: `/Users/karanmanoharan/Documents/projects/pubmaxx-surface-state`.

The base feature stack is deployed. The supplied production verification names deployment `dpl_88fiZ7i4Cgdfrmu5u1wjnRYCnzYq`.
Its build time is `2026-09-07T21:27:03.621Z`.
These local fixes have not been pushed or deployed.

## Commits and scope

| Issue | Commit | Change |
| --- | --- | --- |
| [#1621](https://github.com/Singularityszn/pubmax/issues/1621) | `848f295dd` | Bind savings state to account ID and canonical handle. Preserve serving measure and count only pints. |
| [#1622](https://github.com/Singularityszn/pubmax/issues/1622) | `9aa4ae63c` | Distinguish unavailable venue lookup from confirmed absence on each listing. |
| [#1615](https://github.com/Singularityszn/pubmax/issues/1615) | `97b98a99a` | Always execute seven measured samples for marked routes. Keep ordinary resampling conditional. |

The FAQ and receipt Blob patches remain with their owners.
No budget ceiling, threshold, matcher rule, generated data, or other worktree source changed.
No full verification, app build, simulator, or production performance sweep ran.

## Browser reproduction before changes

Three regression tests ran in fresh Chromium contexts, with one worker.
They used the existing audit server at `http://localhost:3410` and browser request fixtures.
The server reported SHA `1ad2e0a7a7b4000341fc96a9bf6fa57e0a88162c`, deployment `local`, built at `2026-09-07T21:33:08.967Z`.
This server was an existing integration build, separate from this branch's base.
No server process was started, stopped, or changed.

```sh
PW_SKIP_WEBSERVER=1 PW_SKIP_KEYLESS_WEBSERVER=1 PW_PORT=3410 \
  node_modules/.bin/playwright test \
  e2e/landing-savings.spec.ts e2e/out-tab.spec.ts \
  --project=chromium --workers=1 \
  --grep 'landing savings|says the check could not run'
```

All three failed on the reported defects:

- One pint, one half, and one other measure produced `£13.59 over 3 pints`.
- After the real Sign out control ran, `.lpSaved[data-mine]` still had one element.
- An unavailable venue lookup rendered four `Not on our map yet.` lines.

The new assertions remain in [landing-savings.spec.ts](../../../e2e/landing-savings.spec.ts) and [out-tab.spec.ts](../../../e2e/out-tab.spec.ts).
The fixed full-page journeys still need the parent's rebuilt integration server.

## Focused validation

```sh
node_modules/.bin/vitest run \
  __tests__/landingSavings.test.tsx __tests__/pintSavings.test.ts \
  __tests__/outEveryListingRenders.test.tsx \
  __tests__/outDesktopGrouping.test.ts __tests__/outValueFirst.test.ts \
  __tests__/performanceBudgets.test.ts __tests__/perfMeasurement.test.ts \
  --maxWorkers=1
```

Result: **88 tests passed across seven files**.

Savings coverage includes device-only identity, unresolved identity, sign-out, account switch, failed reads, late responses, changed averages, and serving measures.
The account-ID test also holds the handle constant during an account switch.
Legacy rows without a measure retain the shared pint default.
Out coverage includes unavailable and omitted status, confirmed absence, existing map links, and all 148 listing rows.

The first Out test attempt could not resolve `@capacitor/browser` in the older root dependency directory.
The final run used the audit worktree's complete dependencies and passed.
The temporary dependency link was removed after verification.

Changed TypeScript files passed ESLint with `--max-warnings=0`.
`git diff --check` passed.
The budget ratchet passed against `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.
`perf/route-budgets.json` has no diff.
Full type checking remains with the parent integration gate.

### Sampler execution

```sh
PW_SKIP_WEBSERVER=1 PW_SKIP_KEYLESS_WEBSERVER=1 PW_PORT=3410 \
  node_modules/.bin/playwright test e2e/perf-sampling.spec.ts \
  --project=chromium --workers=1
```

Before the fix, the marked case returned three samples instead of seven.
After the fix, both tests passed:

- Ordinary route: four navigations, including one warm-up and three measured samples.
- Marked route: nine navigations, including two warm-ups and seven measured samples.

The fixture supplies stable low timing values and confirms that conditional resampling would return false.
The real sampling loop still navigates, waits for readiness, drains requests, and reads each measured sample.
This proves execution count. It does not measure product performance or prove that production meets its budgets.

### Changed components in Chromium

A small esbuild fixture rendered the actual `LandingSavings`, `AuthContext`, and `OutListingPubPair` modules in Chromium.
It passed measure filtering, account switch during a pending read, failed reads, sign-out, and all three venue states.
It reported no page errors.

The temporary fixture remains at `.e2e/surface-state-client-check.mjs` in this worktree.
Run it with `node .e2e/surface-state-client-check.mjs` after providing dependencies.
It uses account and API fixtures. It does not validate the complete AuthProvider or Next.js page integration.

## Research #1618 handoff: baseline-only

This section records the research snapshot at `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.
Its counts and follow-up plan do not describe the research after parent integration.
The parent's [research input README](../../../data/hyped-pubs-research/README.md) supersedes this snapshot and plan.
That README was verified in the parent checkout at `0bd51086b`.

[#1618](https://github.com/Singularityszn/pubmax/issues/1618) requests a ranked list of at least thirty pubs from the last thirty days.
Each row needs a why line and a source URL.
It also requires a clear statement of sources reached and not reached.

Evidence recorded at the baseline:

- The research file held **48 rows and 141 source URLs**.
- Only **27 rows** carried any `observedAt` date from `2026-08-08` through `2026-09-07`.
- `HypedPubSource.observedAt` explicitly means the day the researcher read the page.
- A recent read date therefore does not prove a recent mention.
- The issue read during the audit had no comments, and its two acceptance boxes were unchecked.
- The Tonight proof documented rendering. It did not document research access failures.

The baseline sources included Reddit 72, TikTok 34, Instagram 27, YouTube 4, and four other web URLs.
URL presence alone does not prove the researcher reached the source.

| File | Follow-up identified at baseline |
| --- | --- |
| [data/hyped-pubs-research/london.json](../../../data/hyped-pubs-research/london.json) | Verify recent mentions. Complete at least thirty supported rows and explain the ranking evidence. |
| [lib/hypedPubs.ts](../../../lib/hypedPubs.ts) | Preserve the meaning of `observedAt`. Keep publication dates separate if they enter the published schema. |
| [scripts/hyped-pubs-ingest.mjs](../../../scripts/hyped-pubs-ingest.mjs) | Publish through the existing validator. Extend source projection only if new metadata must reach the runtime. |
| [public/data/hyped/README.md](../../../public/data/hyped/README.md) | Document any source-field change. |
| [public/data/hyped/london.json](../../../public/data/hyped/london.json) | Generated output. Regenerate it through `npm run ingest:hyped-pubs`. |
| [__tests__/hypedPubsIngest.test.ts](../../../__tests__/hypedPubsIngest.test.ts) | Test any changed ingestion contract, including date meanings. |
| [__tests__/hypedPubs.test.ts](../../../__tests__/hypedPubs.test.ts) | Check the runtime reader if the published schema changes. |
| [docs/proof/tonight-hyped-lede/README.md](../tonight-hyped-lede/README.md) | Existing UI proof, with its local-only limits. |

Follow-up plan recorded at baseline:

1. Record reached and blocked sources in a research note beside the input JSON.
2. Capture each mention's publication date separately from its access date.
3. Confirm at least thirty pubs have qualifying recent evidence. Do not treat the baseline 27 access dates as publication proof.
4. Explain the ranking from that evidence and update only the supported rows.
5. Run the two focused tests above and `npm run ingest:hyped-pubs -- --check` after regeneration.

The baseline ingest path rejected future observations but did not enforce a thirty-day publication window.
No research data or ingestion code changed in this branch.
