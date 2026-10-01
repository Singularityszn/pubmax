# R29 source and public-read findings

Previous goal turn made progress: FAQ RED/GREEN and trusted WebGL style-gap RED/GREEN changed source, full source gate passed and five affected original browser cases passed. R28 tested candidate remains frozen. SDK owns shared runtime; this round starts no local app, browser, database, test, build, install or publication.

## Prices and measures

[Current raw bundle audit](r29-source-price-measure-audit.json) reads 7,603 committed rows, 4,643 with raw listed standing. Only 24 wine rows state explicit millilitres, all at one venue, Sydney Arms. Six beer rows record a serving; other listed categories have no serving field. These are committed served-bundle rows, before fresh eligibility and latest-record projection checks. Builder already excludes known quarantine claims; none of the 23 exact quarantine tuples occurs in this served snapshot. They do not prove current offers or category-wide comparisons. Multi-venue comparable wine proof is missing. Shots already have 72 raw listed rows, 30 named; the earlier blanket classification-gap note must not be repeated as current evidence.

[Three unquarantined item/category contradictions](r29-source-category-contradictions.json) change the next reproduction priority. London Pride 500ml is labelled wine at Bell on the Green; Ting Grapefruit Soda 330ml is labelled wine at Gallimaufry; the Brownswood tonic/ginger-ale/beer mixer label is beer at £2.60. The existing exact source/category/price/label quarantine does not cover these rows. Retain source observations for audit; do not guess a corrected amount, measure or category. Reconcile with the integration parser/data lane before editing.

[Anonymous public venue API reads](r29-public-venue-api-read.json) returned 200 and cache MISS/age0 for all three venues. Brownswood returns its £2.60 published quote in `bundlePrices.listed`, whose source path is the default beer category. This is current API evidence of a problematic beer claim, not native rendered-pint proof. All three responses omit `listedCategoryPrices`; named wine rendering remains a local-candidate source finding. The earlier [selected community endpoint reads](r29-public-price-api-read.json) return prices/signals only and do not test published venue quotes. No response proves deployed SHA, real authentication or durable writes.

## Accounts

Current account-controls responsive/phone, failed-signout, two-tab, switch-identity, sign-in-return and callback-confirmation cases drive native browser UI with Supabase/HTTP doubles. `realResumeCookie` exercises the app cookie route, not real GoTrue identity. `chromium-real-auth` adds only the signed-out contribution/config check when public config is supplied. Guarded `chromium-authenticated` adds `signed-in-review.spec.ts`, which signs in using the real dedicated QA handle/password path and resolves `/u/you`; it has no sign-out assertion. It does not prove Google/OTP delivery or external-provider logout. Existing full-five includes neither optional auth project. No secret file was inspected and no environment absence is inferred. A provider-backed login/logout and durable price read/write still require their authorized account lane.

## Existing observations versus future parsing

Source review traces all three rows to committed `data/uk_prices/site_harvest.jsonl` (Bell219, Brownswood418, Gallimaufry562). Builder prefers working ledger or falls back to committed ledger; it copies stored category/price without reparsing original menus. Fixing future ingestion alone cannot retire these rows. Existing exact quarantine filters publication and runtime readers while preserving audit observations. These three have no focused regression. Parser rejects halves/mixers/bottles and accepts unmeasured draught names, so absent serving on 136 beer rows does not itself prove they are all invalid. Brownswood supplies the concrete historical counterexample to treating every retained beer row as a pint. No shared parser/data change before owner reconciliation.

## Original full-context service-worker failure

Source review confirms registration and controller-change waits precede the 15-second activation timer. Source permits pending shell writes/claim work, a canonical worker winning before the listener, or target replacement. The R28 journal demonstrates target takeover and activation, followed by canonical replacement only after reload. That replacement cannot explain the R25 pre-reload timeout. Preserve original routes, quota, identity, continuity, purge, offline/reveal assertions and timeout. Later original workers=2 full-five comes first; if failure recurs, passive non-awaited phase markers and existing native worker/request journal should capture listener armed, registration completion, candidate state and controller wait. No causal SW repair is applied.

## Existing duplication issue

Current `lib/haversine.ts` and `scripts/lib/geo.mjs` already delegate to pure `lib/greatCircle.mjs`; current haversine tests cover app/script equality and antipodal finiteness. Open issue 1843 is not proof that current source still duplicates the formula. No duplicate refactor or issue closure performed.

No root index, commit, push, PR, merge, deploy, shared SQL or live-account mutation occurred. Full current-source browser/performance gates remain open. Next Core runtime is unallocated until prior owners actually release and coordinator grants a finite slot.

[Fresh fetch and GitHub read](r29-fetched-remote-receipt.json) confirm latest main is already an ancestor of frozen candidate. PR1880 published7c1ea925 and PR1879 published34f11ca2 remain unmerged; later local owner candidates are not substituted for those heads. Source worktree was not rebased or pulled over pending edits.

Owner overlap is resolved for next work: integration retains future parser/backfill modules, while Core owns actual browser reproduction and existing-row/read-boundary repair in separate files. No repair semantics, runtime grant or gate pass follows from ownership. Preserve R28 frozen candidate until native RED.

[Bounded category shortlist](r29-category-review-candidates.json) independently retains the three exact rows and their dataset SHA, checks all 23 quarantine tuples and finds none in the served snapshot. Heuristic cues are review flags, not a new classifier, corrected price or live offer.
