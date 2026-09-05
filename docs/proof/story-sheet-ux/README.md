# Landmark story sheet, before and after

Captured 2026-09-05 on a keyless production build (`next build` with the
Playwright `webServer.env`, served on a private port), Chromium under
SwiftShader, `prefers-reduced-motion: reduce`, at `/map?landmark=covent-garden`.

The captain's own phone shot that opened this work is
`karan-agent-workspace/data/ui-evidence-2026-09-05-story-sheet-390.png`
(outside the repository).

| Width | Before | After |
| --- | --- | --- |
| 390 x 844 | `before-390x844.png` | `after-390x844.png`, `after-390x844-scrolled.png` |
| 768 x 1024 | `before-768x1024.png` | `after-768x1024.png` |
| 1440 x 900 | `before-1440x900.png` | `after-1440x900.png` |

## What the before shots show

- The hero is a broken-image glyph over the alt text, with the CC credit bar
  still under it. Root cause: the Special:FilePath URL 302s to
  Special:Redirect/file and then 301s to `thumb.wikimedia.org`, which the CSP
  `img-src` did not admit.
- On the phone the card is a 78vw box pinned at the chip row's height: its
  title sits under the Pints chip, pins and prices show through its edges,
  and the last "Story pubs nearby" rows are under the planning pill and the
  dock.
- At 768 and 1440 the card sits under the site nav, the toolbar and the
  ambient banners, and its head is clipped.
- Every nearby row repeats "straight-line".

## What the after shots show

- The photo loads. A failing photo (the browser spec aborts every Wikimedia
  host) paints the brass brand treatment and drops the credit with it.
- Phone: the story is the shared bottom sheet. The landmark's name is the
  sheet's one heading, the sheet is full width, and the body scrolls above the
  tab bar, so the last row is reachable and nothing covers it
  (`after-390x844-scrolled.png`).
- Tablet and desktop: the story takes the planner's frame, the left drawer.
  The toolbar and the ambient banners leave its lane the way they leave the
  planner's. The head puts the glyph, the name, "Open chapter" and the way
  out on one row.
- The body says where the landmark is ("In Piccadilly & Soho"), because the
  top bar prints the area the reader chose and may not be rewritten under
  that choice.
- Distances read "134 m", with the straight-line caveat said once in the
  section head.
- The two actions are the button system's primary and secondary; a nearby
  row is name left, distance right, on one baseline, in the data face.

Measured by `e2e/landmark-story-sheet.spec.ts` at 320, 360, 390, 430 and
1440: title geometry, sheet width, `elementFromPoint` ownership of the title
and of the last row, button height and radius parity, row baseline and
right edge, one shared left gutter, no `img` and no `figcaption` after the
image route is aborted.
