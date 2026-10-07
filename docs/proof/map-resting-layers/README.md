# The phone map rests on three layers

Design lane 3. Rules: `docs/rules/components-sheets-chrome-and-navigation.md`, "THE PHONE MAP RESTS ON THREE LAYERS, AND THE BOTTOM CARD IS THE ANSWER."

Built from `3bc62e232` (before) and this branch (after) as keyless production builds, driven with Playwright Chromium on SwiftShader against live OpenFreeMap tiles. Every sheet is before on the left, after on the right.

## Layer count at 390x844, first screen after the first-visit ask is answered

| | Before | After |
| --- | --- | --- |
| Floating bands | top bar, drink chip, On tonight chip, plan pill | top bar, drink chip, bottom card (the plan door is inside it) |
| Round map controls | TfL (with count), credit (i), Near me, Create | TfL (count only when a line is badly disrupted), Near me, Create, and the credit (i) on the left edge above the card |
| Floating pieces in all | 8, and 9 while the ask is up | 7, and the ask replaces the card while it is up |
| Resting layers (bands) | 4 | 3 |

`e2e/mobile-map-chrome-fit.spec.ts` ("the resting map is three layers") counts the bands and the edge controls at 320, 390 and 430.

The phone "after" sheets were taken before the credit (i) went back on the map, so they do not show it. The licence credit stays on the phone map by decision; its berth above the card is proven in `e2e/drink-chip-controls.spec.ts` and `e2e/mobile-map-chrome-fit.spec.ts`.

## Sheets

| File | Shows |
| --- | --- |
| `390-light-before-after.jpg`, `390-dark-before-after.jpg` | Resting map, phone, light and dark |
| `390-light-first-visit-before-after.jpg`, `390-dark-first-visit-before-after.jpg` | First-visit ask: two answers side by side, one row, the location sentence under |
| `1440-light-before-after.jpg`, `1440-dark-before-after.jpg` | Desktop is unchanged: the credit control and the full-width ask strip stay |
| `390-light-peek-drag.jpg`, `390-dark-peek-drag.jpg` | Rest, held 40px, sprung back, held 126px, list open sorted cheapest |
| `390-light-peek-drag-reduced-motion.jpg`, `390-dark-peek-drag-reduced-motion.jpg` | The same pull with reduced motion on |
| `390-safe-area-before-after.jpg` | `Emulation.setSafeAreaInsetsOverride` top 47, bottom 34: light before, light after, dark before, dark after |

The safe-area shots prove layout only, not feel. Haptics, keyboard and the feel of the pull still need a real device (no haptics are added: `lib/nativeHaptics.ts` stays kept actions only).
