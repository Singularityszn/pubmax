# Price Contribution Impact Destination Implementation Plan

**Goal:** Make credited Community Price receipt open visible personal impact.

**Architecture:** Existing receipt gets a fragment target. Existing profile lane
card consumes the `prices` field already returned by trusted lane-stats API. One
stable section id survives loading, degraded, and ready transitions.

**Spec:** `specs/price-contribution-impact-destination.md`

## Task 1: Write RED component contracts

**Files:**

- Modify: `__tests__/priceContributionImpact.test.ts`
- Create: `__tests__/contributionLanesCard.test.tsx`

- [ ] Require encoded anchored receipt URL and anonymous empty render.
- [ ] Require stable anchor in loading, degraded, and ready states.
- [ ] Require price-only ready state and singular/plural price grammar.
- [ ] Run focused Vitest and record RED.

## Task 2: Implement truthful destination

**Files:**

- Modify: `components/map/PriceContributionImpact.tsx`
- Modify: `components/profile/ContributionLanesCard.tsx`

- [ ] Add fragment to credited link only.
- [ ] Give all card states `id="contribution-impact"` and one stable heading.
- [ ] On exact fragment arrival, scroll the mounted section once after owner
  identity resolution if the browser's initial fragment pass ran too early.
- [ ] Consume `stats.prices`, include it in contributed decision, and render it
  beside Visit Reports and Recommendations.
- [ ] Keep degraded state non-numeric and analytics event property-free.
- [ ] Run focused Vitest, lint, typecheck, and diff check.

## Task 3: Prove receipt-to-impact journey

**Files:**

- Modify: `e2e/price-submission.spec.ts`

- [ ] Stub ready lane stats for canonical credited handle with `prices: 1`.
- [ ] Submit from 390px receipt, click 44px impact link, and assert fragment.
- [ ] Assert anchored section intersects viewport and says `1 price`.
- [ ] Assert no horizontal overflow and exactly one empty analytics event.
- [ ] Run exact production Playwright proof and inspect screenshot.

## Task 4: Review and close

- [ ] Independent review for identity, counting truth, loading anchor, analytics
  privacy, and mobile geometry.
- [ ] Run full `npm run verify` on reviewed commit.
- [ ] Re-run exact production browser gate and confirm clean worktree.
