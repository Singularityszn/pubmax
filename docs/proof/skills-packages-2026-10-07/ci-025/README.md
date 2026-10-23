# CI repair 025

This archive records the CI phase for PR 2052 at `061d32ac51a2e48a238e479b9919836b0c40cac1`.
The outer executor owns commits and publication. The published head was the same SHA when this phase started.

## Dock ownership

The invariant is that geometry comes from one accessible Primary navigation and its own list and highlight.
It applies to all three supported phone widths, the initial streamed document, hydration, and client navigation.

The [original CI output](browser-law-raw-full-025.log.txt) is an unchanged copy of the supplied failure.
Both copies have SHA256 `fdda7929a251b24062df8805670b4737a916f78c617912d96e5ebc8c537d1401`.

The [natural runs](dock-natural.log.txt) showed a hidden React `S:0` segment becoming the rendered dock.
The [CPU stress runs](dock-cpu-stress.log.txt) did not reproduce the duplicate.
The [controlled reproduction](dock-before.spec.ts.txt) held animation-frame handoff while hydration continued.
The [raw failure](dock-before.log.txt) reproduced the original strict-mode error on the first attempt and its retry.
The DOM capture identifies one rendered dock and one list inside the hidden `S:0` segment.

The fix selects the accessible Primary navigation and evaluates geometry inside its unique list.
It preserves all four geometry limits and all three supported widths.
It also checks the active You link and the unique highlight.
Two accessible Primary docks still fail the count assertion.

The [controlled after run](dock-after.log.txt) keeps the hidden segment present while checking the owning dock.
It then releases frame handoff, checks that the hidden copy disappears, and exercises `You -> Tonight -> You` navigation.
The [after harness](dock-after.spec.ts.txt) and [JSON result](dock-after-results.json) retain the executable sequence and result.

## Breakpoint ranges

The invariant is that each width comparison contributes its numeric bound.
It applies to ascending and descending ranges, strict and inclusive comparisons, and value-before-width forms.
The recipe must also retain min/max syntax, px/em/rem units, decimal values, import traversal, and unreadable-sheet reporting.
Active token values must continue to reflect the current viewport and theme.

The [review comment](review-comment.txt) identifies the missing lower bound.
The [before recipe](breakpoints-before.js.txt) returned only `width <= 700px` for `(400px <= width <= 700px)`.
The [after recipe](breakpoints-after.js.txt) scans both comparison directions separately.
Separate scans allow both bounds to share the same `width` token.

The [executable fixture runner](recipes.mjs.txt) executes the documented functions in installed Chrome against CSSOM fixtures.
It does not use source-text matches as behavioral evidence.
The [before output](recipes-before.log.txt) passed 5 of 13 cases.
The [after output](recipes-after.log.txt) passed all 13 cases.
The [initial runner failure](recipes-harness-failure.log.txt) preserves an expression-invocation error corrected before the behavioral reproduction.

## Venue-sheet measurement race

The first full local run passed all dock widths but failed the existing venue-sheet smoke check twice.
The [raw run](law-pins-first.log.txt), [JSON report](law-pins-first-results.json), and [failed gate](law-pins-first-gate.log.txt) preserve that result.
The original error contexts and retry trace are retained in the sibling `smoke-*` folders.

The invariant is that the sheet controls are usable and settled before their geometry is measured.
It applies to the close button, tab strip, dock bounds, overflow, and price styling in this test.
The [frame capture](sheet-frames.log.txt) reproduces a close-button bottom of 838px at entry, overlapping a dock starting at 788px.
After the 280ms transition, the button bottom is 373.8125px and the same clearance assertion passes.
The [frame-capture program](sheet-frames.spec.ts.txt) samples the actual rendered transition.

A trial click checks the close button's actionability before the existing geometry snapshot.
It performs no click and leaves every existing assertion and the final real close action intact.
The [focused after run](sheet-after.log.txt) passed five consecutive attempts without retries.

## Validation

The [configuration](playwright.config.ts.txt) uses the repository's production server environment and installed Chrome.
It retains the CI retry setting and uses one worker.
The production build completed at the source SHA above, before the test and recipe edits.
Those edits change no application bundle, so the same production build serves the after checks.
The build output is retained in the natural-run log.

The [source patch](source.patch.txt) records the three changes under test.
The receipt records their hash, the build ID, the full Browser law pins result, and the unchanged flaky-result gate.

The [final browser run](law-pins-final.log.txt) passed 111 journeys, with one existing argued keyless-auth skip.
The [unchanged result gate](law-pins-final-gate.log.txt) passed with zero unexpected results and zero retries.
The [final JSON report](law-pins-final-results.json) includes all three supported dock widths.
The [receipt](receipt.json) records typed findings, source hashes, capacity measurements, and the exact current and published head.
