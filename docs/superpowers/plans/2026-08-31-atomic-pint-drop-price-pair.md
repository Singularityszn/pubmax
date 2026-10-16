# Atomic Pint Drop Price Pair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one signed-in venue-sheet price action commit one Community Price and one Pint Drop together, or commit neither record.

**Architecture:** Keep `/api/price-submit` as the public write boundary. Use one PostgreSQL RPC for the Production Store and a compare-and-restore transaction seam for the keyless memory store. Keep current identity, provenance, rate limit, moderation, and response contracts.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Supabase, PostgreSQL.

**Spec:** `docs/superpowers/plans/2026-08-23-pint-drop-user-flow.md` plus the 30 August 2026 live cut audit.

## Global Constraints

- Do not reopen or copy all of PR #1237.
- Do not add a table or change public response shapes.
- Use the authenticated account actor and current PUBMAXX Handle.
- Keep photos fail-safe: remove uploaded Storage Objects when the database pair fails.
- Use the stored winning Community Price for both returned records.
- Revoke RPC execution from `public`, `anon`, and `authenticated`; grant only `service_role`.
- Captain applies migrations. This branch ships SQL only.
- Run only focused tests, targeted ESLint, and `git diff --check` while resource limits remain active.
- Do not build, browse, deploy, sign in, or post a production Pint Drop in this slice.

---

### Task 1: Prove split writes and malformed receipts fail

**Files:**

- Modify: `__tests__/oneTapPintDrop.test.ts`
- Create: `__tests__/oneTapPintDropSupabase.test.ts`
- Modify: `__tests__/priceSubmitRoute.test.ts`

**Interfaces:**

- Consumes: current `writeOneTapPintDrop` and `/api/price-submit` behavior.
- Produces: `writeOneTapPricePair(input, photos): Promise<OneTapPricePairOutcome>` contract.

- [ ] **Step 1: Write the failing memory transaction tests**

```ts
const outcome = await writeOneTapPricePair({
  venueId: "venue-xjf3n0",
  handle: "karan",
  drinkCategory: "beer",
  priceGbp: 4.2,
  actor: "profile:test",
});
expect(outcome).toMatchObject({ ok: true, price: { priceGbp: 4.2 } });
expect(await readCommunityPrices("venue-xjf3n0")).toHaveLength(1);
expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(1);
```

Add failure coverage that forces the Pint Drop writer to throw. Assert that a new Community Price disappears, a previous newer price is restored, and a concurrent successful equal pair stays visible.

- [ ] **Step 2: Write the failing Production Store receipt tests**

```ts
expect(rpc).toHaveBeenCalledWith("create_one_tap_price_pair", {
  p_actor: "profile:test",
  p_authority_key: expect.stringMatching(/^[a-f0-9]{64}$/),
  p_contributor_handle: "karan",
  p_drink: "Beer",
  p_drink_category: "beer",
  p_drop_id: expect.any(String),
  p_handle: "karan",
  p_pint_photo_key: null,
  p_price_pennies: 420,
  p_submitted_at: expect.any(String),
  p_venue_id: "venue-xjf3n0",
  p_venue_photo_key: null,
});
```

Reject string or null pennies, invalid timestamps, a missing price id, and a mismatched drop id.

- [ ] **Step 3: Run RED**

Run: `npx vitest run __tests__/oneTapPintDrop.test.ts __tests__/oneTapPintDropSupabase.test.ts __tests__/priceSubmitRoute.test.ts --maxWorkers=1`

Expected: fail because `writeOneTapPricePair` and the transaction helpers do not exist.

---

### Task 2: Implement one pair writer

**Files:**

- Modify: `lib/communityPriceStore.ts`
- Modify: `lib/pintDropsStore.ts`
- Modify: `lib/oneTapPintDrop.server.ts`
- Modify: `app/api/price-submit/route.ts`

**Interfaces:**

- Consumes: existing price normalization, Pint Drop DTO/photo helpers, and Supabase admin client.
- Produces: `submitMemoryCommunityPriceSync`, `captureMemoryCommunityPricePairingRollback`, `memoryPintDropPairWriter`, and `writeOneTapPricePair`.

- [ ] **Step 1: Extract the synchronous memory price writer**

Move the current `memoryCommunityPriceStore.submit` body into:

```ts
export function submitMemoryCommunityPriceSync(
  input: CommunityPriceWrite,
  now: number = Date.now(),
): CommunityPriceWriteResult;
```

Keep `memoryCommunityPriceStore.submit` as a thin async-compatible call to that function.

- [ ] **Step 2: Add compare-and-restore memory rollback**

Capture the actor/category row before the pair. Restore it only when the current row still matches the exact saved receipt by id, price, and submission time. This prevents one failed attempt from removing a concurrent successful write.

- [ ] **Step 3: Add Pint Drop memory writer seam**

```ts
export const memoryPintDropPairWriter = {
  create(drop: PintDrop): PintDropDTO {
    addPintDrop(drop);
    return toDTO(drop);
  },
};
```

Route existing memory creation through this seam.

- [ ] **Step 4: Implement Production Store RPC path**

Upload photos first, call `create_one_tap_price_pair` with named arguments, validate the complete receipt, align the Pint Drop price with stored `price_pennies`, and delete uploaded objects after any failure.

- [ ] **Step 5: Replace route compensation logic**

Call `writeOneTapPricePair` once. Remove the separate `submitCommunityPrice`, hide retry, and `PAIRING_REPAIR_REQUIRED` response. Return `INVALID_REQUEST` only for invalid photos and retryable `UNAVAILABLE` for storage failure.

- [ ] **Step 6: Run GREEN**

Run the focused command from Task 1. Expected: all selected tests pass with one worker.

---

### Task 3: Ship the database transaction contract

**Files:**

- Create: `supabase/migrations/20260831120000_0124_one_tap_price_pair.sql`
- Create: `supabase/migrations/rollback/20260831120000_0124_one_tap_price_pair_rollback.sql`
- Create: `__tests__/oneTapPricePairMigrationEffective.test.ts`

**Interfaces:**

- Consumes: `upsert_attributed_community_price_if_newer` and `pint_drops`.
- Produces: service-role-only `public.create_one_tap_price_pair(...)`.

- [ ] **Step 1: Write the effective migration test**

Apply the migration to a temporary PostgreSQL cluster. Prove one transaction writes both rows, a failed Pint Drop insert rolls back the price, an older retry uses the stored winning price in both receipts, only `service_role` can execute the function, and rollback removes the exact function.

- [ ] **Step 2: Add the forward migration**

The function must call `upsert_attributed_community_price_if_newer`, reject an empty result, insert the Pint Drop in the same transaction, and return `price_id`, winning `price_pennies`, `submitted_at`, and `drop_id`.

- [ ] **Step 3: Add rollback**

Drop only the exact RPC signature. Do not change tables, rows, or unrelated privileges.

- [ ] **Step 4: Run the focused effective migration test**

Run: `npx vitest run __tests__/oneTapPricePairMigrationEffective.test.ts --maxWorkers=1`

Expected: pass.

---

### Task 4: Validate and publish branch

**Files:**

- Review: all files changed by Tasks 1 to 3.

- [ ] **Step 1: Recheck memory and disk**

Stop if memory pressure worsens materially or disk headroom falls below the current safe limit.

- [ ] **Step 2: Run targeted lint**

Run ESLint only for touched TypeScript files.

- [ ] **Step 3: Check whitespace**

Run: `git diff --check`

- [ ] **Step 4: Review diff and commit**

Commit message: `fix(prices): commit pint drop price pairs atomically`

- [ ] **Step 5: Push without force**

Push `codex/one-tap-price-pair`. Do not merge, deploy, apply SQL, sign in, or create a production Pint Drop.
