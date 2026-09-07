# Store boundary closeout for #727

Baseline: `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.

[Issue #727](https://github.com/Singularityszn/pubmax/issues/727) still states an exact two-adopter target.
Its comments after [#1158](https://github.com/Singularityszn/pubmax/pull/1158) distinguish the pilot matrix from other adopters' disposition.
The maintenance pair is `feedFreshnessStore` and `occupancyStore`.
Eight stores already use the factory. This change retains all eight and migrates none.
The issue's literal count requires a maintainer reconciliation comment after boundary review.

## Inventory

[`storeInventory.test.ts`](../../__tests__/storeInventory.test.ts) contains the machine-readable fixture.
It records interfaces, selectors, fallback policy, schema-missing policy, authorization owners and exported reset helpers.

The fixture covers all 52 `lib/*Store.ts` files and three additional store-related modules.
It also covers 54 production files with inline configuration calls outside those modules.
An AST scan counts calls, excluding comments and declarations.
The separate documentation fence counts textual references, which include imports and comments.
These counts describe different sets.

The fixture checks exported names, reset helpers, branch counts, exception reasons and factory adoption evidence.
Policy descriptions still require source review. A passing inventory test does not prove every policy description.

The eight policy-heavy store rows received a separate source review at an identical store-file baseline.
It corrected the identity classification and named operation-specific retries, fallback exceptions and caller ownership checks.

Reset fields name exports from the inventoried module only.
Pint Drop memory resets through `lib/pintDrops.ts.__resetPintDrops`.
Identity reset does not reset profiles. Message and profile resets do not clear their warning latches.
Social Post tests can create isolated state through `createMemorySocialPostStore`.

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
No source helper, adapter, route, authorization rule or fallback policy changes.

## Existing factory adopters

All eight call the factory with two existing implementation identifiers.
The factory delegates selection to `selectStore`; it adds no domain imports, queries, catches or authorization.
The inventory fence records each adopter and its test files.

| Adopter | Policy remains outside the factory | Existing evidence | Disposition |
| --- | --- | --- | --- |
| `feedFreshnessStore` | Failure results and held metadata reads | New pilot matrix | Retain as a named pilot |
| `occupancyStore` | Retake window, moderation and column compatibility | New matrix; `occupancyStore.test.ts`; `occupancyStorePre0109.test.ts` | Retain as a named pilot |
| `adultSelfAssertionStore` | Account admission, first assertion and strict missing-schema writes | `adultSelfAssertionRoute.test.ts` covers verified-account admission and first-tap semantics | Retain; route tests are not a complete durable matrix |
| `harvestOverlayStore` | `requireDurable` guard, degraded reads and malformed rows | `harvestOverlayStore.test.ts`; `harvestOverlayStoreMalformed.test.ts` | Retain; the option stays outside the factory |
| `priceTrustEventStore` | Credits, reversals and degraded read results | `priceTrustEventStore.test.ts`; `priceTrustEventStoreDurable.test.ts` | Retain; domain methods keep these rules |
| `stepOutNudgeStore` | Opt-in, withdrawal and send stamps | `stepOutNudgeStore.test.ts` | Retain; these memory tests are not a complete durable matrix |
| `walkRouteStore` | TTL, cache misses and ignored cache-write failures | `walkRouteStore.test.ts` covers both adapters and schema/error fallbacks | Retain as a cache policy exception |
| `wantedStore` | Owner filtering and fulfilment | `wantedStore.test.ts` | Retain; these memory tests are not a complete durable matrix |

## Source differences outside the pilot pair

These source findings do not prove a reachable production failure or a factory defect.
They require focused reproductions before any adapter change.

- `adultSelfAssertionStore.record("")` returns an unpersisted timestamp in memory; the durable adapter rejects the empty account.
- `stepOutNudgeStore` memory send stamps update disabled rows. Durable updates require the corresponding enabled flag.
- `walkRouteStore` memory reads return stored short coordinate arrays. Durable decoding returns `null` when fewer than two valid points remain.

The current tests do not establish complete parity for these inputs or transitions.
Retaining the factory calls does not clear these store-level findings.

## Verification boundary

Focused tests use one worker and no cache. No full gate, build or database suite runs in this closeout.
The full integrated gate and the maintainer's issue reconciliation remain separate evidence requirements.
