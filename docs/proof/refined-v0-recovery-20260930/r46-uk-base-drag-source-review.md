# R46 mobile sheet Home and UK base drag review

Status: source review only. No additional browser, test, build or application edit performed. Original full-five result remains RED: 1293 passed, 24 skipped, four failed. See `r46-fullfive-terminal-receipt.json`.

## Home: native cause established by Core

Core's unchanged native consumed-price-intent journal records a click on `.surfaceNavHome` calling `history.back()`, followed by restoration of the parent price picker. It does not call Home's `history.go(-2)`. This refutes the earlier speculative history-owner policy remedy; no change to `useMapSurfaceNavigation` follows from that speculation.

`components/mobile/MobileSharedSheet.tsx:303` binds SurfaceNav Home to `requestClose`. That function at lines 130-132 starts the gesture dismissal; the dismiss completion calls `onDismiss`. The existing, already verified PubMap wiring at `components/PubMap.tsx:6555` supplies Home as `onClose` and supplies Back when a parent exists as `onDismiss`. Therefore the smallest correct fix is Home bound directly to `onClose`. Back remains `onBack`; Escape remains keyboard Back; scrim and fling remain animated gesture Back through `requestClose` / `onDismiss`. SurfaceNav's Home button already stops pointerdown propagation, so this binding does not initiate header drag.

Meaningful siblings to retain: distinct mounted callbacks for Home, Back and parent scrim/fling; root dismiss fallback; Escape Back; pointerdown isolation. Existing `__tests__/mapShellSheetOwnership.test.ts` covers Escape ownership and overlay controls. Existing native `e2e/surface-back-and-home.spec.ts`, `e2e/map-surface-history.spec.ts` and all imported price-intent lifecycle cases remain required. This source review does not prove the proposed fix passes them.

## UK base drag: native cause not established

Actual fourth failure is `e2e/map-uk-base-layer.spec.ts:286`, normal London entry. After Collapse and one downward drag, `sheet-peek` never appears. The error context records `sheet-half sheet-settling`, then repeated idle `sheet-half`. It preserves The Shaftesbury Tavern and does not establish the pointerdown target, captured gesture, or height at gesture start.

Concrete timing seam: lines 275-277 click Collapse, wait only for `sheet-half`, then measure the header. `components/mobile/useSheetHeightDrag.ts:102-107` changes the resting snap immediately and then starts height animation. Thus the class is a target-state declaration, not evidence of settled geometry. This GL spec sets viewport 390 x 844 and does not itself select reduced motion. `lib/useSpringValue.ts` honors reduced motion only when the actual media query matches.

The drag hook at lines 222-250 accepts only a noninteractive header target, captures its pointer, stops the spring and records the current rendered sheet height. At lines 283-316 it resolves release from that recorded height and actual travel, with a paused release using zero velocity. `lib/sheetSnap.ts` uses the starting rendered height as the start detent's reference. A 260px paused drag begun near the full height can consequently resolve half correctly, whereas the same travel from a settled half resolves peek. Separately, measuring the header during its downward collapse can leave the later mouse-down coordinate above the current header, so no gesture starts. These are source-supported alternative schedules, not causes proved by this failure.

Other bounded competing event: the sheet's captured scroll handler settles the current snap (`MobileSharedSheet.tsx:261`), and reveal-settle sequence changes explicitly settle half (lines 125-129). The artifact does not show either event occurring. No hydration claim follows: the sheet already responded to Expand, text entry and Collapse.

## Required next diagnostic, UNRUN

Run the unchanged original path first. Record native pointerdown/move/up/cancel targets and coordinates; hit-test at the exact measured drag point; same-frame sheet/header rectangles, inline max-height, snap class, motion attribute and computed transform before Collapse, after class change, at pointerdown and at release. Record captured scroll events and successive geometry through actual rest. Do not alter map state or hook refs. Retain the original 260px gesture and exact peek assertion.

Only if native evidence establishes the moving-header schedule, compare a separate fresh control that waits for actual idle half geometry before measuring and performs the same one native drag. Preserve exact peek, nonmodal map, mounted-node identity and price draft assertions. No tolerance, extra drag retries, target reduction or CSS padding is justified by source alone.
