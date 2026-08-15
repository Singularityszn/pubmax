# Closed-PR remediation ledger - 2026-08-05

Scope: closed PR review comments from Greptile, CodeRabbit, and Claude-linked
review prompts; current product tree only. Skill-pack churn and generated data
are outside this ledger.

## Review inventory

- 631 closed PRs scanned.
- 2,227 bot comments scanned, including 766 inline comments.
- Greptile supplied 114 distinct P0/P1 findings. Most historical findings were
  already addressed by later PRs; each current candidate was checked against
  HEAD before implementation.
- CodeRabbit comments were primarily summaries, rate-limit notices, or findings
  already fixed by PR68. No independent current Claude bot thread was found;
  Greptile's Claude fix prompts were included as source comments.

## Fixed in this pass

| Source finding | Change | Regression proof |
| --- | --- | --- |
| PR493 mini-map detour bounds | Include routed vertices in bounds; key state by venue id and name; hide old state while a new request is pending. | `__tests__/routeMiniMap.test.ts`, scoped lint/typecheck |
| PR511 leave-by and distance copy | Say leave-by, preserve straight-line qualifier, avoid price-gate miscopy. | `__tests__/nightModeCard.test.ts`, `__tests__/nightAreaCoverage.test.ts` |
| PR491 mixed walk source | A mixed ORS/straight route remains approximate. | `__tests__/walkRoute.test.ts`, `__tests__/walkRoute.route.test.ts` |
| PR494 forwarded-header rotation | Add route-wide 200/min backstop alongside per-client limiting. | `__tests__/walkRoute.route.test.ts` |
| PR485 failed freshness refresh | Do not stamp request time or zero rows after a loader failure. | `__tests__/cronRefreshWhatsOnRoute.test.ts` |
| PR492 retired profile aliases | Metadata canonical and OG URLs resolve to current handle. | `__tests__/profileMetadata.test.ts` |
| PR506 Moment return path | Preserve current query parameters in desktop return URL. | `__tests__/siteNav.test.ts` |
| PR472 final Night Crawl action | Final stop cannot submit a second arrive/skip action. | `__tests__/nightCrawl.test.ts` |
| PR486 deletion redaction | Snapshot departing display name before profile erasure; fail closed if redaction marking fails. | `__tests__/profileDeleteRedaction.test.ts`, `__tests__/redactionChoke.test.ts`, migration 0070 |
| PR482 DST window | Resolve London offset at each night-window boundary. | `__tests__/tflDisruption.test.ts` |
| PR483 stale price story | Key async reads, ignore cancelled responses, clear stale reads by key, refresh after confirmation. | `__tests__/venuePriceStoryContract.test.ts` |

## Deferred with evidence

- PR470 freeze coverage needs route discovery rather than another hand list.
- PR471 attribution refresh needs partial-write preservation in the enrichment
  tool. It touches generated data and deserves its own data fixture pass.
- PR472 offline retry needs an outbox or durable retry contract, explicitly
  described by the existing component as a later lane.
- PR476 SVG fallback, PR478 native entry consumption, PR481 patch coverage,
  PR483 full component interaction coverage, PR487 atomic Story publication,
  and PR488 operator proposal persistence remain open candidates.
- PR484 visit-report actor spoofing is already derived from request identity in
  current HEAD.

## Bloat proposal

Sol-ready draft spec: `docs/specs/2026-08-05-review-bloat-and-store-dedupe.md`

Ticket proposal: `docs/tickets/2026-08-05-review-bloat-tickets.md`

Parent tracker issue: https://github.com/Singularityszn/pubmax/issues/727

Child tickets remain drafts until Sol confirms the narrow factory boundary and
pilot stores.

## Verification

- Focused remediation suite: 14 files, 157 tests passed.
- Full suite: 7,689 of 7,699 tests passed. Ten failures are pre-existing data
  artifact/tracing failures: `data/generated/venue_details.jsonl` is stale
  versus the rebuilt 1,997-venue index, and the tracing/validation subprocesses
  time out under this shared worktree. No changed product test failed.
- Scoped ESLint: no errors; one existing complexity warning was removed from
  the changed Night Crawl callback dependency set.
- Scoped TypeScript: passed with `/tmp/pubmax-tsconfig.json`, excluding shared
  worktrees. The repository-wide command traverses shared worktrees and did not
  complete within eight minutes.
- Desktop/mobile browser attempt was recorded. The in-app browser webview did
  not attach, Chrome DevTools timed out, and Computer Use service startup failed.
  No browser state was changed and no sensitive data was entered.
