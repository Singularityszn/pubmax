# R36 latest-main price and auth semantics

Source-only comparison. Base `76de20674da64604af22872ff42ee08fca7f156a`; exact upstream main `af5a08f78afad1091efc7ed97d1906daf9b47db1` (PR1880 merge, 20:54 UTC); Core committed HEAD `5de246205d8ff0fd1d601c94f3a73639476a3db1`, plus its current working-tree price changes. No code/test edits, checkout, merge, index, publication or runtime checks performed. Fresh final verification remains PENDING.

A main-to-Core diff includes Core's unmerged work. An API field or safeguard present only in Core was not necessarily deleted by upstream: compare each side with the common base before assigning responsibility. R35's seven extra quarantines, Sacred gin serving recovery and base-price presentation are current working-tree changes, not all represented by the supplied Core HEAD.

## Concrete reconciliation blocker: normalization can bypass exact quarantine

Upstream adds `normalizeSiteHarvestLedgerRow` (`lib/siteHarvestLedgerCore.ts`, upstream lines 29-48). It splits a wine label ending in an explicit two/three-digit ml measure into a name and typed serving, preserving an already typed serving. It is used for ledger collect/dedupe and by the builder **before** its `push` quarantine check (`scripts/build_uk_price_bundle.mjs`, upstream lines 170-179 and 218-250).

Core's R35 quarantine compares exact source URL, category, price and printed label (`lib/ukPriceBundle.ts:73`, `:107`). Combining those files mechanically would change these identities before the check:

| Raw retained claim | Upstream normalization | Core exact quarantine affected |
| --- | --- | --- |
| Bell on the Green, wine £4, `London Pride 500ml` | `London Pride`, `500ml` | Original label no longer matches |
| Gallimaufry, wine £3, `Ting Grapefruit Soda 330ml` | `Ting Grapefruit Soda`, `330ml` | Original label no longer matches |

This is a source-supported collision, not an executed merged-build result. It can republish the very wrong-wine claims R35 removed if normalization precedes the only exact check. Keep raw exact-claim rejection before lossy name normalization, and ensure canonical read eligibility cannot readmit an already normalized form of those same evidenced claims. Do not use category-wide removal or invent corrected categories/prices. Focused raw/normalized regression cases must retain changed-source/price/label controls and neighbouring valid wine claims before regenerated-data or native verification.

Integration's parser/backfill owner must reconcile `siteHarvestLedgerCore` and builder normalization with Core's retained-record policy owner in `ukPriceBundle`. Upstream's existing wine normalization serves a real separate contract: `Merlot 175ml` and later `Merlot` plus typed `175ml` must have one collect identity so a fresh source read supersedes the old quote instead of creating duplicates. Dropping normalization would lose that contract. Keeping it must not weaken exact category evidence.

## Price behavior that must survive

- Both sides retain typed `servingSize`, serving-aware `bundleRowDedupeDrinkKey`/`ukPriceBundleCollectKey`, authority exclusion of estimates and the existing nineteen exact category quarantines from PR1880. Core also has four prior Punch and Judy exact claims and seven R35 claims. Preserve the union, not one side's shorter table.
- Current Core `bundleRowServingSize` (`lib/ukPriceBundle.ts:116`) recovers only the literal retained `Gin ~ 25 ml Sacred –` claim from Brownswood's exact source/category/lane/standing; existing `row.servingSize` wins. Its builder reuse and `listedCategoryPrices` projection share this rule. Upstream lacks this narrow recovery. No default gin/spirits measure should be introduced.
- Upstream has no `lib/listedCategoryPrices.ts`; its venue route and `VenueDrinkPrices` lack Core's separate named menu quote projection. Core adds source/date/exact or unknown serving, same named drink/serving dedupe and bounded category quotes. This is unmerged Core behavior, not proof of upstream removal.
- Current Core's base-only GET in `app/api/price-submit/route.ts:589` concurrently reads approved rows for the exact canonical base ID and opts into neutral beer quotes (`:596`). Curated projection defaults still exclude beer (`lib/listedCategoryPrices.ts:34`). Community and published availability remain independent. `UnverifiedPubSheet` shares the pure `PublishedMenuPrices` renderer; estimates do not enter that published lane. Preserve these seams together, with the no-extra-request and late-selection ownership tests.
- Upstream's report-observation helper extraction in `app/api/price-submit/route.ts` is already incorporated in current Core. It is not a missing behavior fix. Its separate GET/public quote behavior still requires semantic reconciliation with Core additions rather than replacement of the whole route.

Generated bundle and historical reconciliation artifacts are the data owner's output. Do not copy one side's entire `rows.json` or rewrite historical withdrawal proof to resolve these source contracts. Core's repaired generated rows must retain the evidenced removals/serving while the approved producer incorporates upstream normalization. Raw observation custody and historical publication snapshots remain distinct from current eligibility.

## Auth: shared confirmation contract, later Core races, upstream ban disclosure

Both branches already contain the important PR1880 callback change relative to base: capture/scrub URL credentials before awaited work; verify an unowned access/refresh pair identifies one account; ask for identity-labelled confirmation before SDK session installation; keep locally owned callback completion and ordinary eager session bootstrap. `lib/authRedirect.ts`, callback route and the underlying auth-client/load files compared here match current Core. Account transport files `lib/authedFetch.ts` and `lib/authProviderRevision.ts` also match upstream; do not replace or duplicate those protections.

Core adds later safeguards absent upstream:

- `lib/authSessionBootstrap.ts:116` checks cancellation before installing a redeemed cookie session. `AuthProvider` aborts stale bootstrap for a newer auth decision, distinguishing its own restored-session event (`:701`), and explicit logout aborts it immediately (`:1227`).
- `AuthProvider` buffers/reconciles cancelled callback installations and preserves a later login, including same-account token replacement, while keeping explicit/cross-tab sign-out final. The callback helper's `installingTokens` field (`lib/authCallbackClient.ts:89`) supports exact input/result discrimination. Keep these coupled controller/helper/test changes.
- `AuthProvider` imports the eager status owner `AccountOnboardingHost` directly and the canonical handle leaf. Lazy form presentation does not postpone auth bootstrap or onboarding status requests. Replacing it with upstream's facade import would undo Core's deliberate module boundary.

Upstream does add a genuine behavior fix absent Core: distinguish a verified provider `user_banned` failure in **unowned** callback preparation from generic verification failure. Upstream `authCallbackClient.ts:109`, `:115`, `:118` returns `status: "banned"`; `deviceAccountSwitch` preserves the provider's refusal classification; upstream `AuthProvider.tsx:807` shows the existing banned notice without installing that session. New upstream tests cover original-user, mint and refreshed-user bans and ordinary refusal remaining generic. Current Core only has the generic prepared failure variant, though locally owned establishment still recognises bans.

Auth owner must port that narrow classification into Core's newer cancellation-aware controller, retaining `installingTokens`, post-logout/newer-login arbitration, original token-pair verification and non-banned failure behavior. Copying upstream's entire provider would discard Core race fixes; copying only the helper enum without its controller/device-switch/test branches would leave the new behavior incomplete. This review does not claim real-provider browser proof from those source tests.

## Required reconciliation before final gate

Publisher/NoMistakes owns Git integration and publication. Integration owns future parser/backfill and serving-name normalization; Core owns retained-record eligibility and its price API/UI behavior. Auth owner owns the combined callback/bootstrap contract. Agree the exact quarantine-before-normalization and cancellation-aware banned-notice composition before a final gate, then run meaningful focused regressions, official regeneration/delta checks and fresh native/full verification under the next runtime grant.

The separate [cache in-flight source finding](r36-cache-inflight-review.md) remains unchanged: clearing does not retire pending cache reads. No user-visible private leak was proved. Latest-main merge neither closes that source finding nor authorises a speculative repair. The seven pending Prospect regression claims and the unverified unnamed rum control also remain separate acceptance work, not broad quarantine policy.
