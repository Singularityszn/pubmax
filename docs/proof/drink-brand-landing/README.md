# Governed drink brand landing proof

Browser proof for `/drink/guinness`.

| Proof | Viewport | Contract |
| --- | ---: | --- |
| `guinness-390-light.png` | 390 × 844 | Mobile landing in light theme |
| `guinness-390-dark.png` | 390 × 844 | Mobile landing in dark theme |
| `guinness-1440-light.png` | 1440 × 900 | Desktop landing in light theme |

These controlled images record mobile light and dark rendering plus desktop
rendering. The [Playwright spec](../../../e2e/drink-brand-landing.spec.ts) owns
current browser assertions and regenerates the artifacts.

Run the proof with:

```bash
CI=1 NODE_OPTIONS=--max-old-space-size=4096 \
  PW_PORT=35131 \
  PW_NEXT_DIST_DIR=.next-drink-brand-proof \
  npx playwright test e2e/drink-brand-landing.spec.ts --project=chromium --workers=1
```

Screenshots are produced by the test. They use reduced motion, fixed viewport
dimensions, and a fresh keyless browser state.
