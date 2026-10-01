# Current generated route transfer: bounded design, production HELD

SOURCE ONLY. Root reports applied 5573952 and verifyV2 green; this lane did not run it. e510 reverse browser regression remains Root-owned and UNRUN here. No production patch/prototype created before actual native RED. Current seven source hashes appended below. Immutable e510 comment incorrectly says auth boundary alone is doubled: auth plus deterministic basemap tiles are doubled; generator is real. Correct in a separately reviewed future test revision, not frozen artifact.

## Source cause and existing authority

`components/plan/MobilePlanActivation.tsx:179,268` keeps the original generator body in result.mapRoute; `PubMap.tsx:4190,5363` reverses coordinator IDs but never supplies current route to that child; MapRouteTransferButton.tsx:33 writes captured body. Thus source predicts current visible route and transferred route diverge. e510 must establish native RED before repair.

Unanchored generation at app/api/plans/generate/route.ts:209-221 mints V1, not V2. lib/planGrounding.server.ts:99-125 signature-checks an allowed candidate set plus operation digest; accepted order is deliberately irrelevant. Exact original stop-set Reverse therefore may reuse the ORIGINAL V1 token/key without changing or minting proof. This proves source compatibility, not a performed server lock. Anchored generation uses V2; lines407-417 reject changed order and expiry. Never reuse V2 for a reversed order or detach its accepted Stop1 silently.

Proof classification must reuse the existing draft codec's client inspection (`lib/planRouteDraft.ts:282-310`) or original server response identity, never turn decoded unsigned claims into authentication. That codec only recognizes readable payload/expiry; final create/PATCH verify signature and operation. V2 payload at lib/planGrounding.server.ts:169-179 binds ordered primary IDs, allowed IDs, anchor identity/source/outcome, operation digest and issued/expiry times. It DOES NOT include NightContext or selected quote amounts. Context is independently cleaned/reconciled in planGeneration.server.ts:273 onward (city/area match and canonical anchor), then quote category/zeroProof/source/day/measure revalidated at create/PATCH. Preserve those separate fences; do not claim a signed context that does not exist.

POST app/api/plans/route.ts:110-154 canonicalizes identities/names and re-reads exact selected prices; unanchored create may save ordinary canonical manual stops with grounded=false if proof missing, while anchored invalid proofs explicitly 422. PATCH app/api/plans/[id]/route.ts:170-190 requires current revision, canonical identities and current quote revalidation; grounded upgrades remain proof-controlled. No new mutation endpoint needed for draft transfer.

## Minimal production outline after actual RED

Four existing seams: PubMap.tsx, MobilePlanActivation.tsx, MapRouteTransferButton.tsx, lib/mapRouteTransfer.ts. Keep current coordinator8aded pricing/lifecycle, stable key and all 5573952 seven-path changes. Pass actual DISPLAYED route (not builtIds alone, not unrelated suggested state) from PubMap to activation/transfer. Do not add new state/cache/store. Existing mapRouteTransfer leaf builds bounded existing ParsedPlanRouteDraft.value and writer owns validation/storage. Button must not silently navigate with old draft when current-route write fails; expose retry/write refusal and retain current Map route instead.

1. Unchanged exact ordered unique IDs: original response/draft/proof unchanged.
2. Same unique IDs reversed, original unanchored V1 lane: reorder original stop records by actual route IDs; preserve each canonical name and same selected quote/backup ownership, same proof/key. Do not reattach dropped or off-route identities. Strip obsolete order-dependent route totals/timing/confidence from changed-order draft or explicitly label original generation metadata as historical; no new signed assertion. Existing draft expiry/proof inspection can turn even this valid-shape token into stale preview. No fake expiry extension or generated proof rewrite.
3. Identity edit/add/remove or current Suggest route different from captured result: transfer actual canonical displayed IDs/names and explicit requested category/zeroProof, not original stop list. Preserve only price evidence still present under current coordinator authority; current mutation invalidates saved quote snapshot, so do not resurrect it from captured response. Retire old proof/key/revision, totals/confidence and no-longer-applicable alternatives. Use existing routeStale=true preview + existing Plan “This route needs a refresh”/“Regenerate route” action; user can inspect exact edited route first. This does not make an edited route newly grounded or silently restore original order. If end-state requires locking the exact edited route as an ordinary manual plan without regeneration, existing ordinary canonical create path can support it, but conversion must be explicit and tests must confirm intended context/constraint policy. It is not automatically equivalent to grounded generation.
4. Anchored changed order/identity: do not pretend same V1 exception. Existing releaseAcceptedPlanContext in lib/planComposerHandoff.ts:274-304 removes all THREE acceptance owners (intent + session plan anchor + local route anchor), keeps route and removes V2 proof. Need explicit visible release/review semantics when action moves held Stop1; no isolated field deletion that hydration would reassert. Transfer actual route as stale preview afterwards. This is coupled acceptance regression, not permission to mutate proof or globally forbid valid manual routes.

Writer/cleaner limits: existing max12 stops/max24 alternatives, exact closed keys; no guessed servings/context defaults. If displayed route is partially resolved, duplicated, empty or outside permitted counts, show truthful actionable refusal, never captured original route fallback. Context stopCount must agree with actual edited route if retained; use existing allowed normalization, not hidden original count. Selected source/day/amount/serve are untrusted hints until server resolver revalidates. Context category/zeroProof override rules remain authoritative.

## Required acceptance after genuine RED

- Original e510: real Vodka generation, original quote/null budget, one native Reverse, actual reversed visible names+IDs, Plan same reversed IDs/category. Additional existing V1 lock test must show original unchanged token verifies reversed same set, and expired/edited-outside-set controls remain false.
- Mounted current-route transfer: unchanged preservation; Reverse (no token manufacture); edited current route seeded stale, no original IDs or old quotes resurrected; no-op unchanged; actual storage write failure leaves current route visible with recovery; unrelated suggested route must not inherit generated proof.
- Anchored counterpart retains held Stop1 or explicitly releases all owners; rejects reordered original V2 server proof. Exact preview can remain visible with refresh state, but no silent original route or false lock success.

## Separate reload/share context policy, not closed by transfer patch

Coordinator pricing is memory-only; useBuiltIdsPersistence stores only IDs. Existing crawlUrl encodeCrawl already supports drink lens; generic crawlShareMapHref constructs pubs/city/band but does not carry generated NightContext/selected evidence. Restored IDs plus lost pricing therefore can show canonical Pint copy under original nonbeer intent. Do not claim this fixed by current packet.

Smallest future policy uses EXISTING closed route draft writer/parser for device restore (24h envelope; server proof only2h), exact ID/order association and existing category URL field for intentional public share. Restore explicit category/zeroProof separately from money/proof. A public URL may carry approved closed drink/serving intent only; never price/source/date/grounding proof, account capability or GPS. Re-read approved public quote authority for present IDs; unknown/expired/unavailable provenance means no quote/no total, never a Pint substitution. Valid original device draft can preserve evidence as an untrusted preview hint with existing expiry and server revalidation; malformed, stale or mismatched draft must not adopt route authority. No new storage key or public private-context leakage.

Existing local draft is device state, not authenticated member entitlement. Account switching must not grant member/capability access; member routes still use existing server permission boundary. Source transfer has no account-bound draft owner, so no new real-provider/account isolation claim. Native reload, signed-out shared nonbeer route, expired proof, changed quote source/date and account switch controls remain separate required proof before declaring complete.

## Exact current source hashes

```json
{
  "components/map/pubmap/useMapPlanCoordinator.ts": {
    "current": "8aded913d257cccd5cfc0889376508c9e6b157db6c1807b12d4487d08344ede2",
    "expected557After": "8aded913d257cccd5cfc0889376508c9e6b157db6c1807b12d4487d08344ede2"
  },
  "components/map/RoutePanel.tsx": {
    "current": "fb2c4801277276124c34add073588e2b63ebd20aa4b2173969c829706c131ab7",
    "expected557After": "fb2c4801277276124c34add073588e2b63ebd20aa4b2173969c829706c131ab7"
  },
  "components/map/route/RouteMetrics.tsx": {
    "current": "ab7ccf85a2e6c5aa7a146c26791d2610713f5e92c3c8de7196f57da6b96e9b5d",
    "expected557After": "ab7ccf85a2e6c5aa7a146c26791d2610713f5e92c3c8de7196f57da6b96e9b5d"
  },
  "components/map/route/RouteList.tsx": {
    "current": "2436ee4b8aaea2eb65e6235ef15a1e41292cb5cc6ed0819d3852775a1ae3b9bb",
    "expected557After": "2436ee4b8aaea2eb65e6235ef15a1e41292cb5cc6ed0819d3852775a1ae3b9bb"
  },
  "components/map/route/RouteHeader.tsx": {
    "current": "c864442f308e52e4eae0ee7dbded44e65272bd82f1179d3a40a8c49348445528",
    "expected557After": "c864442f308e52e4eae0ee7dbded44e65272bd82f1179d3a40a8c49348445528"
  },
  "components/plan/MobilePlanActivation.tsx": {
    "current": "e77c1ba913d3e82ad333ffdd9c53ed04913244680964bc630ed91a51408b78f6",
    "expected557After": "e77c1ba913d3e82ad333ffdd9c53ed04913244680964bc630ed91a51408b78f6"
  },
  "components/PubMap.tsx": {
    "current": "cb8e8280036a8d6febfe51215582feed56bebdd92ea8f54f705e9f3c26f10085",
    "expected557After": "cb8e8280036a8d6febfe51215582feed56bebdd92ea8f54f705e9f3c26f10085"
  }
}
```
