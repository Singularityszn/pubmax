# Venue reveal proof (Slice A)

390×844 phone captures for the trust-choreography entrance on tap-a-pub.

## Scenarios

1. **Established (Beermat Drop)** - corroborated in-window community price: beat 3 uses `venueRevealPriceChrome--drop` (6px rise + spring settle). Chrome only; the figure node stays static.
2. **Provisional (flat slide)** - one report in window: beat 3 uses `venueRevealPriceChrome--slide` (6px rise, no overshoot).
3. **Repeat tap** - second pick in less than 8s: `venueReveal--short` (160ms photo crossfade, no stagger).
4. **Reduced motion** - `prefers-reduced-motion: reduce`: no `venueReveal` classes on the inspector (`e2e/venue-reveal.spec.ts`).

The transition contract, including desktop drawer parity, is owned by
[`docs/MOBILE_FLOW_SPEC.md`](../../MOBILE_FLOW_SPEC.md). This file owns the
capture scenarios and evidence location.

## Capture

```bash
npm run dev
# chrome-devtools-axi: emulate 390x844, open /map, tap a priced pub
```

Save pairs as `before-*.png` / `after-*.png` in this folder when validating a visual change.
