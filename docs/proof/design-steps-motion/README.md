# Design steps, reveal-in, eyebrow stack

Shipped ranks 1–3 from the Lovable taste scout (`pubmax-design-taste-lovable`).

## Before

Plan and map choose-area baselines live in the taste report:

`/Users/karanmanoharan/karan-agent-workspace/data/pubmax-design-taste-lovable/screenshots/pubmax/plan-390x844.png` (and `1440x900`).

## After (this branch)

| Surface | 390×844 | 1440×900 |
| --- | --- | --- |
| Plan intake wizard | `plan-intake-390x844-after.png` | `plan-intake-1440x900-after.png` |
| Choose area sheet | `choose-area-390x844-after.png` | `choose-area-1440x900-after.png` |

## Motion

- Step swap frames: `reveal-step-area-t0.png`, `reveal-step-time-t1.png`, `reveal-step-time-t2.png`
- Reduced motion (no entrance animation): `plan-intake-reduced-motion-390x844.png`

## Checks

- Unit: `__tests__/sheetStepProgress.test.tsx` (step semantics + 260ms/`reduce` CSS contract)
- Typecheck + eslint on touched files: clean
- Full `npm run verify`: paused on famous-venue data expiry (#1814) only; no venue data touched
