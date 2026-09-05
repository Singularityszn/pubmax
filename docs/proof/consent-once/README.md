# One consent decision per screen

Measured on 5 September 2026 against `npm run dev` on this Mac, dark scheme,
reduced motion, with the analytics consent key and the session prompt budget
cleared before every arrival.

## The finding

The preview verification of the v0 deploy (Observations 1) saw `/u/you` offer
the same Allow / No thanks choice twice at once: the account settings block
(`#analytics-settings`, `components/profile/PubmaxxAccountHub.tsx`) and the
fixed arrival bar (`components/AnalyticsConsentPrompt.tsx`). The `before` shots
show the bar lying across the settings block that asks the same question.

## The rule

`lib/consentSurfaceRoutes.ts` is the one place it is written down: a route whose
own document carries a live consent control owns the decision on that screen, so
the arrival bar does not render there and spends no prompt budget on it. Every
other route keeps the bar exactly as it was. The settings block is untouched,
both buttons keep their behaviour and the copy is unchanged.

## Counts

| Route | Before: arrival bar | Before: settings block | After: arrival bar | After: settings block |
| --- | --- | --- | --- | --- |
| `/u/you` | 1 | 1 | 0 | 1 |
| `/` | 1 | 0 | 1 | 0 |
| `/tonight` | 1 | 0 | 1 | 0 |

Both widths, 390x844 and 1440x900, answer the same way. After the change the
document holds exactly one `Allow` and one `No thanks` on every one of the three
routes.

## Files

- `before-u-you-390x844.png`, `before-u-you-1440x900.png` - the two controls at once.
- `after-u-you-390x844.png`, `after-u-you-1440x900.png` - the settings block alone.
- `before-root-*.png`, `after-root-*.png`, `before-tonight-*.png`, `after-tonight-*.png` -
  the arrival bar still meets a reader off that route.

## Held by

- `__tests__/consentSurfaceRoutes.test.ts` - the rule, and that the bar reads it
  rather than restating a path.
- `e2e/ux-consent-chrome.spec.ts` - exactly one consent control on `/u/you`, the
  bar still on `/` and `/tonight`, at both widths, beside the rules PR 1471 and
  PR 1475 already own.
