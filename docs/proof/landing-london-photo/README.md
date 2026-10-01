# Landing London view

Desktop browser capture at 1028 x 1325, dark theme, 1 October 2026.

| Before | After |
| --- | --- |
| ![Drawn London pub map](before-map.png) | ![Tower Bridge and Thames photograph](after-photo.png) |

The photograph uses existing responsive files under `public/landing/`. Their source and licence are recorded in `public/landing/ATTRIBUTION.md`. The map remains reachable through the primary action.

Browser proof: `e2e/landing-london-photo.spec.ts` checks that the skyline decodes at 390, 768 and 1440 pixels, with no horizontal overflow. `e2e/landing-find-my-pint.spec.ts` checks that the primary action stays above the fold and the price contribution path still opens.
