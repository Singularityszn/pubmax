# Design Craft D1-D8 Evidence

PR-ready evidence for the Wave 2 surface-craft work.

## Outcome

- Sheets and drawers use interruptible spring physics. Pointer-down stops the
  current spring at its presented value, drag tracks one-to-one, and release
  velocity selects and drives the next snap. Reduced motion jumps directly to
  the target.
- Sheet material uses neutral translucent layers, 20px backdrop blur, and
  layered neutral micro-shadows. Dark mode was tuned first at 82% material
  opacity. Reduced-transparency and high-contrast modes use opaque fallbacks.
- Landing hero and venue titles now carry the page hierarchy. Nine equal-weight
  boxes were removed or subordinated:
  - two landing secondary calls to action lost button-box chrome;
  - two of three landing signal cards became shorter support rows;
  - five venue surfaces were flattened: tab panel, contributor price, price
    list, claim card, and mobile peek summary.
- One price-plaque signature now covers `PriceBadge`, feed rows, borough pages,
  venue rows, mobile peek, recaps, and MapLibre pin figures. DOM stamps share
  the same classes and MapLibre receives an RGB-normalised equivalent of the
  same ink, surface, and tilt.
- Dark desktop map roads and road labels are quieter. Pub clusters are larger
  and more opaque, so product marks read before road geometry. Zoom gates,
  grouping radius, symbol collision policy, and six-tab navigation are
  unchanged.
- D4 was verified only. `--panel-raised` and all locked brand colours remain
  unchanged.

## Accessibility and motion

- Locked dark ink against coral measures **5.961:1**.
- Locked dark ink against coral-bright measures **7.077:1**.
- Lowest Plan call-to-action stop is **5.961:1** in both themes, above the
  required 5.96:1.
- Keyboard venue list opens a named venue without canvas hit-testing: pass.
- Desktop drawer traps focus, restores focus on Escape, and follows a newly
  selected venue: pass.
- Mobile full-sheet focus containment and reduced-motion snap: pass.
- Spring animation frames are bounded, cancel on unmount and retarget, and drop
  `will-change` at rest. Desktop drawers stay transform-only. Phone sheet height
  animation is contained with `contain: layout paint` because actual height is
  required to preserve sticky-footer geometry at every snap.

## Visual evidence

Mobile captures use a 390 by 844 CSS-pixel viewport at device pixel ratio 3.
Desktop captures use 1440 by 900 at device pixel ratio 1. Captures were written
under `/tmp`, moved into the repository, and verified for dimensions.

| Surface | Theme | Before | After |
| --- | --- | --- | --- |
| Landing, 390 by 844 | Light | [before](screenshots/design-craft/before-landing-390-light.png) | [after](screenshots/design-craft/after-landing-390-light.png) |
| Landing, 390 by 844 | Dark | [before](screenshots/design-craft/before-landing-390-dark.png) | [after](screenshots/design-craft/after-landing-390-dark.png) |
| Landing, 1440 by 900 | Light | [before](screenshots/design-craft/before-landing-1440-light.png) | [after](screenshots/design-craft/after-landing-1440-light.png) |
| Landing, 1440 by 900 | Dark | [before](screenshots/design-craft/before-landing-1440-dark.png) | [after](screenshots/design-craft/after-landing-1440-dark.png) |
| Venue sheet, 390 by 844 | Light | [before](screenshots/design-craft/before-sheet-390-light.png) | [after](screenshots/design-craft/after-sheet-390-light.png) |
| Venue sheet, 390 by 844 | Dark | [before](screenshots/design-craft/before-sheet-390-dark.png) | [after](screenshots/design-craft/after-sheet-390-dark.png) |
| Venue sheet, 1440 by 900 | Light | [before](screenshots/design-craft/before-sheet-1440-light.png) | [after](screenshots/design-craft/after-sheet-1440-light.png) |
| Venue sheet, 1440 by 900 | Dark | [before](screenshots/design-craft/before-sheet-1440-dark.png) | [after](screenshots/design-craft/after-sheet-1440-dark.png) |
| Desktop map, 1440 by 900 | Dark | [before](screenshots/design-craft/before-map-1440-dark.png) | [after](screenshots/design-craft/after-map-1440-dark.png) |
| Desktop map, 1440 by 900 | Light | Not changed as a defect baseline | [after](screenshots/design-craft/after-map-1440-light.png) |
| Price stamp, 1440 by 900 | Dark | Covered by surface baselines | [after](screenshots/design-craft/after-price-stamp-1440-dark.png) |

## Taste authority applied

- `apple-design` and `emil-design-eng`: direct manipulation, critically damped
  defaults, strong type hierarchy, and fewer decorative containers.
- `find-animation-opportunities` and `improve-animations`: motion is limited to
  state continuity, sheet snaps, drawer entry, and pointer acknowledgement.
  Decorative entrance sequences were rejected.
- `review-animations` and `animation-vocabulary`: spring retargeting, projected
  release, one-to-one drag, cancellation, reduced motion, and resting state were
  audited explicitly.
- `animation-systems` and `optimize-web-animations`: shared motion ownership,
  bounded frame integration, animation cleanup, containment, and temporary
  `will-change`.
- `beautiful-shadows` and `glass-dark-ui`: layered neutral shadows and
  dark-first translucent material with solid accessibility fallbacks.
- `css-border-gradient`: inspected, then rejected because an ornamental border
  would restore equal-weight box chrome.
- `no-ai-slop`: no new product copy, decorative glow, generic card grid, or
  ornamental gradient was introduced.

No UI library or open prototype decision was needed, so no dependency or
prototype surface was added.

## Verification

- Focused accessibility Playwright: 3 passed with one worker.
- Mobile sheet reduced-motion and focus Playwright: 1 passed with one worker.
- Focused unit suites for spring motion, sheet snaps, materials, map hierarchy,
  price stamps, MapLibre colour normalisation, and collision policy: pass.
- Browser console after final dark and light captures: no MapLibre style errors.
- `npm run verify`: pending final closeout run.
- `NEXT_DIST_DIR=.next-prod npm run build`: pending final closeout run.
