# Governed drink brand landing proof

Browser proof for `/drink/guinness`.

The brand-by-area page (`e2e/drink-brand-area-landing.spec.ts`) asserts its own
rendered geometry at 320, 390, 430 and 1440 in both themes. It tracks no images
either; its refresh lane is at the end of this file.

No tracked images. Codex captured three (`guinness-390-light.png`,
`guinness-390-dark.png`, `guinness-1440-light.png`) before the map arrival,
the headings and the count disclosure changed, so they showed copy the page no
longer prints. A proof shot that disagrees with the page is worse than none.

The [Playwright spec](../../../e2e/drink-brand-landing.spec.ts) is what
currently asserts the rendered contract: above-fold answer, 44px targets,
visible focus, no horizontal overflow, exact hrefs, light and dark. Normal
validation writes fresh screenshots under Playwright's untracked
`test-results` output. Refreshing the tracked set is the command below, and it
needs a machine that can hold a production build.

A refresh writes these three files here:

| File | Viewport | Contract |
| --- | ---: | --- |
| `guinness-390-light.png` | 390 × 844 | Mobile landing in light theme |
| `guinness-390-dark.png` | 390 × 844 | Mobile landing in dark theme |
| `guinness-1440-light.png` | 1440 × 900 | Desktop landing in light theme |

Run clean validation with:

```bash
CI=1 NODE_OPTIONS=--max-old-space-size=4096 \
  PW_PORT=35131 \
  PW_NEXT_DIST_DIR=.next-drink-brand-proof \
  npx playwright test e2e/drink-brand-landing.spec.ts --project=chromium --workers=1
```

Refresh the tracked proof only when a deliberate visual change needs new
evidence:

```bash
CI=1 NODE_OPTIONS=--max-old-space-size=4096 \
  PUBMAX_UPDATE_DRINK_BRAND_PROOF=1 \
  PW_PORT=35131 \
  PW_NEXT_DIST_DIR=.next-drink-brand-proof \
  npx playwright test e2e/drink-brand-landing.spec.ts --project=chromium --workers=1
```

Both commands use reduced motion, fixed viewport dimensions, and a fresh
keyless browser state. Review every tracked PNG diff before committing a proof
refresh.

## Brand-by-area proof

The brand-by-area spec has the same two lanes under its own switch, and a
refresh writes into `docs/proof/drink-brand-area-landing`. That directory holds
no images today, for the reason above.

```bash
CI=1 NODE_OPTIONS=--max-old-space-size=4096 \
  PUBMAX_UPDATE_DRINK_BRAND_AREA_PROOF=1 \
  PW_PORT=35132 \
  PW_NEXT_DIST_DIR=.next-drink-brand-area-proof \
  npx playwright test e2e/drink-brand-area-landing.spec.ts --project=chromium --workers=1
```

Drop `PUBMAX_UPDATE_DRINK_BRAND_AREA_PROOF` to validate without writing tracked
files. It captures `victoria-guinness-{320,390,430,1440}-{light,dark}.png`.
