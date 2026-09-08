# Store boundary closeout for #727

Source review started at `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.
The reconciled candidate includes audit source `7d393b87c45dfbd4662d22cb5c27b90051f51505` and Social `786a5672b83414bb47a9cda5baacbb4230cdc72b`.
Those source integrations do not establish a passed full gate or production rollout.

[Issue #727](https://github.com/Singularityszn/pubmax/issues/727) still states an exact two-adopter target.
Its comments after [#1158](https://github.com/Singularityszn/pubmax/pull/1158) distinguish the pilot matrix from other adopters' disposition.
The maintenance pair is `feedFreshnessStore` and `occupancyStore`.
Eight stores already use the factory. This change retains all eight and migrates none.
The issue's literal count requires a maintainer reconciliation comment after boundary review.

## Inventory

[`storeInventory.test.ts`](../../__tests__/storeInventory.test.ts) contains the machine-readable fixture.
It records interfaces, selectors, fallback policy, schema-missing policy, authorization owners and exported reset helpers.

The fixture covers all 53 `lib/*Store.ts` files and three additional store-related modules.
It also covers 56 production files with inline configuration calls outside those modules.
An AST scan counts calls, excluding comments and declarations.
The separate documentation fence counts textual references, which include imports and comments.
These counts describe different sets.

The fixture checks exported names, reset helpers, branch counts, exception reasons and factory adoption evidence.
Policy descriptions still require source review. A passing inventory test does not prove every policy description.

The original eight policy-heavy store rows received a separate source review at the original store-file baseline.
It corrected the identity classification and named operation-specific retries, fallback exceptions and caller ownership checks.

Reset fields name exports from the inventoried module only.
Pint Drop memory resets through `lib/pintDrops.ts.__resetPintDrops`.
Identity reset does not reset profiles. Message and profile resets do not clear their warning latches.
Social Post tests can create isolated state through `createMemorySocialPostStore`.

## Messages and Social source reconciliation

The fixture now describes the actual integrated source, including the following changes.

- Messages permits schema fallback and memory-format IDs only when `requiresSupabaseStore()` is false.
- Failed inbox reads remain degraded. Failed durable thread reads throw `MessageReadUnavailableError`; routes map this to retryable 503.
- Healthy empty threads remain empty successes. Membership refusals remain distinct from failed reads.
- `socialGalleryStore` is the 53rd exact store. Its direct selector is not a ninth factory adopter.
- Gallery upload ownership, reservation expiry, replay and mutation-version checks remain in the store and RPCs.
- Social consent selects memory for approved-tag and media-key reads only. Its consent and admin methods remain durable.
- Social media stores local bytes when unconfigured. Delivery still asks the verified actor and consent-store authorization first.
- The inventory also records the new configuration checks in Social media delivery and profile ownership.
- Pint Drop receipt-column fallback now cleans an omitted bill object after the insert succeeds; it does not add memory fallback.

`messagesProductionFallbackRoute.test.ts` and `messageThreadReadFailureRoute.test.tsx` contain the integrated Messages regression proof.
`socialGalleryStore.test.ts`, `socialGalleryDurable.test.ts`, `socialPostConsentStore.test.ts` and `socialPostMedia.test.tsx` cover the new Social boundaries.
These are evidence references, not a claim that those runtime or database suites ran in this reconciliation.
New gallery instances can isolate their request maps. No reset export clears the shared Social media byte map.
Social `786a5672` adds draft-cleanup UI proof and does not add another store or inline backend module.

## Pilot contract matrix

[`storePilotParity.test.ts`](../../__tests__/storePilotParity.test.ts) executes the existing adapters and the real production guard.
It mocks Supabase query responses. It does not start PostgreSQL or prove a deployed schema.

| Condition | Feed freshness | Occupancy |
| --- | --- | --- |
| Keyless | Reads and writes memory stamps | Reads and writes memory reports |
| Configured and healthy | Upsert payload and read projection match memory facts | Insert, retake update and read projection match memory facts |
| Configured moderation | Not applicable | Flag RPC and unhide update retain their contracts |
| Missing schema in development or preview | Memory write and read | Memory write and read |
| Missing schema in production | Write returns `failed: true`; held metadata can satisfy a read | Report and moderation writes reject; reads report `degraded: true` |
| Ordinary write failure | Returns `failed: true`, without a memory write | Rejects, without a memory write |
| Ordinary read failure | Returns `null` | Returns a degraded answer |
| Unconfigured production | Selector rejects | Selector rejects |
| Reset | Clears its memory stamps without touching occupancy | Clears its memory reports without touching feed stamps; resets column compatibility state |

The production read difference is intentional in the current code and remains explicit in the matrix.
The shared helper, durable adapters, routes, authorization rules and fallback policies remain unchanged.
Three memory edge contracts now match their existing durable implementations, as described below.

## Existing factory adopters

All eight call the factory with two existing implementation identifiers.
The factory delegates selection to `selectStore`; it adds no domain imports, queries, catches or authorization.
The inventory fence records each adopter and its test files.

| Adopter | Policy remains outside the factory | Existing evidence | Disposition |
| --- | --- | --- | --- |
| `feedFreshnessStore` | Failure results and held metadata reads | New pilot matrix | Retain as a named pilot |
| `occupancyStore` | Retake window, moderation and column compatibility | New matrix; `occupancyStore.test.ts`; `occupancyStorePre0109.test.ts` | Retain as a named pilot |
| `adultSelfAssertionStore` | Account admission, first assertion and strict missing-schema writes | `adultSelfAssertionRoute.test.ts` covers account admission and first-tap semantics; `adultSelfAssertionStore.test.ts` checks blank IDs on both adapters | Retain; configured successful record/readback remains outside this matrix |
| `harvestOverlayStore` | `requireDurable` guard, degraded reads and malformed rows | `harvestOverlayStore.test.ts`; `harvestOverlayStoreMalformed.test.ts` | Retain; the option stays outside the factory |
| `priceTrustEventStore` | Credits, reversals and degraded read results | `priceTrustEventStore.test.ts`; `priceTrustEventStoreDurable.test.ts` | Retain; domain methods keep these rules |
| `stepOutNudgeStore` | Opt-in, withdrawal and send stamps | `stepOutNudgeStore.test.ts`; `stepOutNudgeStoreParity.test.ts` covers send stamps; `cheapPintQualificationRace.test.ts` covers concurrent decline and send during durable qualification | Retain; the separate durable qualification fix is integrated. Missing-schema and outage parity remain outside this matrix. |
| `walkRouteStore` | TTL, cache misses and ignored cache-write failures | `walkRouteStore.test.ts` covers both adapters and schema/error fallbacks | Retain as a cache policy exception |
| `wantedStore` | Owner filtering and fulfilment | `wantedStore.test.ts` | Retain; these memory tests are not a complete durable matrix |

## Verified memory edge fixes outside the pilot pair

Three separate domain commits align memory behaviour with the existing durable implementation.
They do not widen the factory or change durable storage policy.

- `adultSelfAssertionStore.record` rejects blank account IDs in both adapters, without a database call.
- `stepOutNudgeStore` leaves send stamps unchanged after withdrawal or decline. Enabled stamps still apply only to their owner.
- `walkRouteStore` uses the existing decoder in both adapters. Fewer than two valid points produce a cache miss.

The nudge proof executes the actual Supabase adapter and PostgREST client against a local fetch implementation.
It checks owner isolation, delayed stamps, shared-token retention and absent-row no-ops.
These changes neither prove an invalid-account browser bug nor cancel a notification already in flight.

The focused tests prove these input and transition contracts. They do not establish complete parity for every adopter operation.

## Durable qualification race

The separate fix `d92020aa2408ad64e43c39f840e5248de8889a84` is integrated here as `d70bc200f2e9f80bfae85e358b61298e7c95a7e4`.
Independent review cleared that exact source commit. This qualification finding is separate from the memory disabled-stamp fixes.

Previously, account qualification read a preference row and upserted the whole snapshot.
A concurrent decline or completed send could lose its consent, token or send state.
Durable qualification now writes only `owner_actor`, `updated_at` and `cheap_pint_qualified`.
PostgREST updates only supplied fields on conflict; migrations 0094 and 0111 provide defaults for a new row.
The returned row drives eligibility. Already declined or sent rows keep their existing no-write path.

`cheapPintQualificationRace.test.ts` exercises the account helper and preference routes with controlled database ordering.
It covers decline and send races, a competing first-row decline, default-off creation, existing subscriptions and repeated terminal qualification.
The source worker recorded three failing races before the fix and 29 passing tests across seven files afterward.
The independent reviewer inspected the seven focused cases and that log, without running them again.
This proves the controlled route/store cases, not live PostgreSQL or the separate 0157 replay route.
No runtime test was repeated during this integration. The final combined gate remains required.

## Verification boundary

Focused tests use one worker and no cache. No full gate, build or database suite runs in this closeout.
The full integrated gate and the maintainer's issue reconciliation remain separate evidence requirements.
