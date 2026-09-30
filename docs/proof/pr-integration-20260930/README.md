# Nine-PR integration review, 30 September 2026

Integration starts at main `76de20674da64604af22872ff42ee08fca7f156a` and retains all original PR heads as ancestors. Merge this integration with a merge commit to retain that history. Original PRs: #1860, #1861 and #1870-#1876. Exact original heads and diffs were pinned before review and checked again before publication.

Two independent review axes examined documented standards and originating specs/PR intent. Standards found no hard breach and two possible smells: duplicated evidence conversion (fixed) and outdated absence-oriented identifiers (non-blocking). Spec found an incompatible standalone Context.dev bump (superseded by #1873's complete v3.2 migration), anchor-only generation omitting wine evidence, and old proposal acceptance restoring evidence after Plan context changed. Both evidence defects are fixed. #1861 is screenshot proof with no separate acceptance spec.

Conflict resolutions retain both selected-venue sentinel and map-surface history guards; remembered-city fallback and category-aware contribution URLs; strict-modal suspension and shared inert ownership; deferred focus restoration; behavior-based drawer checks; and deployment exclusions for artifacts and `.gnhf`. Lockfiles were regenerated rather than hand-merged.

Before fixes, focused API/PostgreSQL regressions failed three assertions: omitted anchor evidence, wine restored after beer selection, and wine restored after zero-proof selection. Afterwards, 125 focused tests passed. Another 29 tests cover the updated Context.dev fixture, drawer inert behavior, proposal filtering and rollback. The disposable production browser initially reproduced the stale 675p wine quote in real PostgreSQL after accepting an old proposal. With migration 0168 applied, both wine and cocktail browser journeys pass, including saved evidence, reload, forged-hint refusal and context-change proposal acceptance. The fixture now explicitly includes 0168.

Fresh `npm run verify:no-mistakes` passed on integrated source: 1,714 unit test files, 18,317 tests, six declared skips; serial shared-memory harness, ten tests; PostgreSQL/RLS suite, 44 files and 449 tests; another serial shared-memory harness, ten tests. Typecheck, dead-code, data validation, browser-skip source gate, freshness and high/critical audit passed. Lint exited zero with 16 warnings. Three durable feeds could not be measured without credentials; this run does not report them fresh.

The existing area-news producer refreshed one recent sourced fact after a narrower run found none. No generated artifact was hand-restamped and no freshness ceiling was raised.

Production build and browser sweep evidence belongs in the integration PR once complete. Production has only migrations through 0160; see [ordered apply and rollback handoff](production-migrations.md). No production migration or deployment was performed by this review.
