# ADR 0011: Venue operator rail (shipped core, gaps named)

## Status

Accepted (design track for remaining gaps; no Social or Stripe scope)

## Context

Wayfinder §3.5 still labels the venue operator rail “Entirely MISSING.” The
codebase already ships a claim → review → proposal path. Soft-launch strategy
needs an honest contract: what operators can do today, what stays captain-only,
and what must not be built yet (payments theatre, city splash).

## Decision

**Shipped core (do not rebuild):**

- Domain: `lib/venueOperators.ts` (`validateOperatorClaim`, pending → verified /
  rejected / revoked)
- Store: `lib/venueOperatorsStore.ts`
- Claim API: `app/api/venue-operators/claim/route.ts`
- Correction proposals: `lib/operatorProposals.ts`, `app/api/operator-proposals`
- Pub surface: `components/operators/OperatorRailPanel.tsx` on ledger pages and,
  behind "Run this pub?", in the venue sheet's pub fold
- Published facts: an accepted proposal publishes one operator fact
  (`lib/operatorFactsStore.ts`, migration 0217), shown as "From the pub" on
  the venue sheet and, when dated for tonight, on Tonight. It changes no rank,
  pin colour, price band or order
- Admin review: `app/admin/AdminClient.tsx`
- Certification: `docs/WRITE_SURFACE_CERTIFICATION.md`

**Still out of scope for Horizon 0–1:**

- Automatic ownership verification (owner / moderator review remains the gate)
- Proposals overwriting trusted venue facts without admin review
- Merchant checkout, tabs-as-debt, or Stripe Connect
- Marketing non-London packs off operator claims

**Horizon 2 direction (design only until London density proves out):**

- Verified operators correct hours / menus and respond to price disputes
- Operator responses never invent community-price authority; corroboration
  policy in ADR 0010 stays the map gate

## Consequences

- Agents extend the existing rail; they do not greenfield a second claim system
- Wayfinder §3.5 should be updated by captains to “partial / shipped core”
- Anti-goals in `AGENTS.md` and `docs/plans/PLG_STRATEGY.md` forbid payments
  theatre before venue trust density
