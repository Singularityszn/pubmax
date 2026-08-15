# Price Contribution Impact Destination

Status: ready for implementation on 2026-08-15.

## Goal

Make `See your impact` fulfil its promise after a credited Community Price log.
The link must open the contributor's own profile at a stable record that shows
the current visible price contribution count.

## Journey contract

1. Server accepts a signed Community Price and returns credited canonical handle.
2. Receipt shows `See your impact` only for credited attribution.
3. Link targets `/u/<encoded-handle>#contribution-impact`.
4. Profile scrolls to one stable impact section while its data loads.
5. Ready section shows current `prices`, `reviews`, and `recommendations` counts.

## Truth contract

- Price count comes only from existing lane-stats API and contributor store.
- Count describes currently visible contribution record. It does not promise a
  new row or `+1` because a repeat submission can replace an owned price key.
- Loading and degraded states do not show zero.
- Hidden contributions keep existing store policy. This slice does not change
  moderation, counting, identity, or server authority.
- Anonymous or malformed legacy attribution gets no profile action.
- Analytics remains one `price_impact_opened` event with no properties. Handle,
  Venue, and price must not enter analytics.

## UI contract

- Stable section id is `contribution-impact` in loading, degraded, and ready states.
- Section heading is `Your contributor record`.
- Ready state includes `price` or `prices` with correct singular grammar.
- A price-only contributor is not shown the empty state.
- Link remains at least 44 by 44 CSS pixels with visible keyboard focus.
- Anchored section lands in the 390px viewport without horizontal overflow.

## Verification

- Unit: credited encoded anchor URL, anonymous empty render, price-only ready
  card, singular/plural grammar, stable anchor in every state, and degraded
  honesty.
- Browser: stub ready lane stats with one price, submit at 390px, click receipt,
  confirm anchored section is in view and says `1 price`, confirm one empty
  `price_impact_opened` payload, 44px target, and no horizontal overflow.
- Full: focused lint, typecheck, `git diff --check`, `npm run verify`, exact
  production Playwright gate, and independent review.

## Out of scope

- Public contributor leaderboard changes.
- New API, store, migration, CSS system, analytics property, or metric.
- Quantity levels, drinking streaks, or claims about alcohol consumed.

