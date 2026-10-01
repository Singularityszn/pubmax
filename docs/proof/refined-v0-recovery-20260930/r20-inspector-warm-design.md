# Inspector concurrent warm design R20

Source-only design. Only this receipt written. No app/test edits, runtime, network, install, build or index operation. Root-owned map changes preserved. `codebase-design` read for locality/interface judgment; installed Next16.3 docs/runtime read. Existing R19 actual waterfall remains reproduction evidence, not a measured fix.

## Smallest proposal

Preserve exact current top-level dynamic expression in `components/PubMap.tsx:259-261`:

```tsx
const VenueInspector = dynamic(
  () => import("@/components/map/VenueInspector"),
  { ssr: false, loading: () => <VenueSheetSkeleton /> },
);
```

Add only best-effort same-module import to existing selected-detail effect, after its existing guard and before starting HTTP request (`PubMap.tsx:4978-4982`):

```tsx
useEffect(() => {
  if (!selectedVenueId || detailById.has(selectedVenueId) || isUkBaseId(selectedVenueId)) return;
  const requestedVenueId = selectedVenueId;
  let cancelled = false;
  // Start presentation assets while the selected venue's detail is requested.
  // Rendering below still owns load failure and its existing skeleton.
  void import("@/components/map/VenueInspector").catch(() => {});
  warmVenueDetail(requestedVenueId).then((result) => {
    // existing result/status/canonical-id/cancellation implementation unchanged
  });
  // existing cleanup/dependencies unchanged
}, [detailById, resolveMapSelection, selectedVenueId]);
```

This is a second call site to the same existing module, not a second module implementation or loader interface. No new state, bespoke promise cache, retry counter, exported preload API, timeout, generic abstraction or scheduler. Module/chunk sharing must be verified in emitted production requests rather than assumed from Vitest imports. Catch is essential to prevent speculative import rejection becoming unhandled; it does not fabricate success or substitute data. Do not return a fallback module here, mutate detail status, request deployment reload or move actual renderer into this warm callback.

Measured aim: Inspector's6 JS +17 CSS/126.3KiB group currently starts4-9ms after API completion; later R19 samples API starts5.37-5.65s, ends5.98-6.27s. Start that group alongside request rather than after result. Approx600ms serialization is removable in theory; actual gain remains unproved because MapLibre transfer, shared CSS queue and scene assembly contend. No unrelated tab split, earlier-shell fetch or map-icon rewrite in this proposal.

## Why keep literal dynamic expression

Installed Next guide `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md:24,239` describes dynamic/lazy composition and explicit `import()` inside top-level dynamic call for module matching/preloading. `node_modules/next/dist/build/babel/plugins/react-loadable-plugin.js:112-128` traverses loader AST for Import nodes and builds import metadata. Moving import into separately referenced `loadVenueInspector` function can hide node from that traversal. That Babel source is not proof of Turbopack Rust transform details, but keeping current literal avoids relying on either compiler's indirect-call recognition.

Current App Router `.../shared/lib/lazy-dynamic/loadable.js:40` creates React.lazy from loader. Lines43-46 always pass `error:null` to loading renderer; returned component75 has no public `.preload()` facility. Do not cast and call `.preload`, or copy Pages Router loadable retry assumptions.

## Selection and cancellation contracts

- Empty selection: existing guard prevents warm and HTTP. Existing route-first fallback rendering (`PubMap.tsx:3135-3137`) remains untouched.
- UK base id: existing `isUkBaseId` guard prevents both warm and curated HTTP; base sheet follows existing `UnverifiedPubSheet` path. Do not warm curated Inspector on base selection.
- Already cached full detail: existing `detailById.has` guard prevents warm and repeat HTTP. Inspector is already renderable so warming after render offers no meaningful gain. Alias resolution still sets canonical id/cache through existing result branch4992-5009.
- Unknown/non-base id: **not currently validated by this effect.** `lib/crawlUrl.ts:271-272` accepts any nonempty sel. Detail API owns exact id validation (`lib/venueDetailIndex.ts:78,108,260`), including venue/city/famous bar/food/restaurant forms. Proposed warm therefore may fetch otherwise unused Inspector assets for syntactically invalid or valid-but-missing id. It must not mount Inspector, change unknown/not-found notice, or turn a404 into a chunk-error screen. This is disclosed extra speculative work, not a behavior-free optimization.
- Detail503/network/parse failure: `lib/warmVenueDetail.ts:42-60` answers `failed` and evicts in-flight entry, not cached success. Existing selected controller maps it to unavailable. Warm must not replace unavailable with loading or success. If a slim venue already exists, renderer still shows venue with existing unavailable warning; if none exists, existing notice path wins.
- Close/switch/city teardown: cleanup `PubMap.tsx:5012-5014` sets cancelled before late HTTP updates. Keep it exactly. Import download cannot be cancelled, but no callback sets selection or UI state. Late module success after close must not reopen sheet; late A API response after switching B must not replace B. Shared detail cache may still retain fetched public record, as existing behavior.
- Missing/unavailable notice owner `lib/pubMap.ts:187-197` waits loaded, checks resolvable/base/status; PubMap5017-5039 publishes notice then clears unresolved selected id. Do not move notice logic into warm code.
- Stable skeleton/peek/sheet frame remain current renderer5457-5498. No change to outer drawer/portal, focus trap5159, selected-label/price-trust owner, chosen tab, draft/composer or account bootstrap.

If strict requirement is “no Inspector assets requested for any missing/unavailable id,” concurrent warm cannot satisfy it without trusted earlier venue knowledge. Waiting until API success recreates measured serialization. Checking `selectedVenueResolvable`/existing record before warm also misses cold deep-link path that this optimization targets. A separate exact id-guard leaf could exclude malformed syntax by moving current canonical regex+guard once and re-exporting, but that adds server/client ownership scope and still cannot identify valid-but-missing IDs. Do not duplicate regex, use photo-id validator with different contract or assume `startsWith("venue-")` covers famous venues. Default bounded diff discloses speculative behavior, with unchanged UI outcomes.

## Existing import failure recovery: protected and unprotected

Current Inspector has no local rejection catcher. React.lazy failure from its literal dynamic loader propagates to route `app/error.tsx`; it can take map/list with it. Route “Try again” calls segment retry72, which does not itself clear lazy rejected promise or Turbopack chunk resolver. `requestDeploymentSkewCheck` exists but Inspector does not invoke it. `components/DeploymentSkewRecovery.tsx:25-31` reloads only changed deployment, guarded against dirty input; `lib/deploymentSkewRecovery.ts:101-102` returns same for unchanged version. Thus it is not generic same-deploy asset retry.

There is no newly proved Inspector chunk-failure bug from R19 success traces. Warm rejection is caught; if no Inspector is ever rendered, actual missing/unavailable notice remains owner. If valid venue later renders, renderer still reuses runtime import outcome and has original error path. Earlier speculative request could fail at time original delayed request would have succeeded, so preservation must be tested under real production chunk failure, not described as guaranteed recovery.

Closest actual recovery implementation: `AccountOnboardingHost.tsx:94-119,135-143`, explicit fresh-document reload on body import failure and dirty-input guarded reconnect; regression `__tests__/accountOnboardingPresentation.test.tsx:149-173` checks stable modal, skew event and actual reload call. Production `e2e/account-onboarding-chunk-recovery.spec.ts` aborts all failed first-document attempts and allows asset only after real new document. This is a pattern for separately reproduced Inspector recovery, not reason to add new error UI to this warm patch.

Canvas dynamic attempt/boundary `PubMap.tsx:128-167,2385-2388` is another owned pattern; do not copy its custom attempt map just to warm Inspector. Real production retry evidence matters more than fresh React component identity. No recovery behavior changed by proposed tiny patch.

## Meaningful RED/GREEN and parity proof

Primary RED-capable production case: extend nearest existing selected-venue/browser coverage with real held detail response. In fresh un-warmed context, intercept `/api/venue/venue-4xlgb0`; fetch original real response, hold delivery with controlled promise. Also temporarily hold actual London slim index responses while checking ordering, so an independent viewport shard cannot provide selected record and make unchanged renderer look concurrent. Release all holds in finally. Core pack presently contains no Princess Louise/4xlgb0 match, but a later cell can, so API hold alone is not sufficient isolation. Independently detect actual Inspector-exclusive script body using paired unique markup markers `venueAddress` and `venueTabShort` (current compiled Inspector owns both), or learn URL in throwaway context as `e2e/map-blocked-fallback.spec.ts:34-73` does for MapLibre. No generated filename/private build dependency. Assert Inspector request actually starts while detail response still held and no alternative selected record was delivered. Unchanged renderer cannot initiate it from a selected record; warm patch can. Release original responses and verify actual Princess Louise h3, estimated£6.50 label, real Overview interaction, close/Escape focus, canvas/selection. Preserve same status/canonical payload, not mocked invented price. Verify one asset cohort, no duplicate API request. Use serviceWorkers:block and fresh context so earlier warm cannot make false pass.

Selected timing gate is separate: same five-cold profile/native observation/readiness boundary and strict gate after meaningful functionality proof. Do not add wait-before-click, redefine cold, raise ceiling or skip first sample. Held-response test is ordering proof, not LCP measurement.

Parity cases: empty and base IDs do not start curated warm; actual404 retains unknown notice, actual503 retains lookup-failed/unavailable; delayed A response after B selection and after sheet close cannot reopen/overwrite; alias returns canonical id without second detail request. Existing `__tests__/warmVenueDetail.test.ts:49-139` covers successful cache, in-flight join,404/failed retry and alias cache; `__tests__/pubMap.test.ts:233-285` covers detail status/notice distinctions. These tests stay unchanged unless meaningful added controller evidence is required. String-only import/fence test does not prove concurrency.

Separate RED-capable recovery reproduction before any recovery repair: abort actual Inspector-exclusive script on **every first-document attempt**, leave real venue HTTP/other scripts intact; inspect current error/focus/escape and press current retry. Count actual new document and new asset request rather than swapping module mock. If current retry stays failed, report that concrete product defect separately. On future owned reload recovery, same first-document aborts must yield stable sheet-local failure if that is approved UX, explicit retry actual new document, same chunk allowed/success and correct title/trust state. Test both390 and1440, keep version endpoint stable so automatic skew reload cannot fake explicit retry. No recovery case implemented or run here.

Bounded implementation scope proposed: only `components/PubMap.tsx` warm call/comment plus an existing suitable selected/browser spec ordering case. No custom loader files or new error presentation mandated. Existing error behavior is an outstanding candidate reproduction, not a source-only completion claim.
