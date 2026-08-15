# Governed drink brand landing proof

Browser proof for `/drink/guinness`.

| Proof | Viewport | Contract |
| --- | ---: | --- |
| `guinness-390-light.png` | 390 × 844 | Mobile landing in light theme |
| `guinness-390-dark.png` | 390 × 844 | Mobile landing in dark theme |
| `guinness-1440-light.png` | 1440 × 900 | Desktop landing in light theme |

The Playwright journey also checks 320 × 844 and 430 × 932. It verifies the
governed 347-venue count, 20 cheapest rows, first result, publisher state,
hero price publisher, shared collection date, touch targets, page width, Map
brand state, Back restoration, the explicit log picker, and the unknown-brand
404. At 320, 390, and 430 pixels, every one of the 20 rank and price elements
must be visible and horizontally inside the viewport. Focus proof covers the
primary action, secondary action, Ledger row link, and publisher link; shared
route CSS covers the remaining links of each repeated type.

Run the proof with:

```bash
npx playwright test e2e/drink-brand-landing.spec.ts --project=chromium --workers=1
```

Screenshots are produced by the test. They use reduced motion, fixed viewport
dimensions, and a fresh keyless browser state.
