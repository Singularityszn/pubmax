# The venue command bar at 768: pinned to the bottom edge, off the price row

Proof for #1516, filed by the UI sweep on 5 September 2026: on the venue sheet at
768x1024 the sticky command bar (Make it Stop 1, Share) sat about halfway down
the viewport as a full-width band over the price row once the drawer was
scrolled. Every shot is the venue Overview of Fox and Pheasant (`venue-133bdp8`,
a listed £6.00 bundle row and no drops), signed in through the e2e auth doubles,
on a production build of the app with `/api/pint-drops` answered empty by a
route mock. `before` is origin/main at `2d00af6d2`; `after` is this branch.
Phone shots are 390x844 at device scale 2 with the sheet at its full snap,
tablet shots 768x1024 and 820x1180 at scale 2, desktop shots 1440x900 at
scale 1, light theme, reduced motion. Each shot is taken after the trigger from
the issue: `scrollIntoView({ block: "center" })` on the first price row.

## What was measured

Bar boxes are CSS px, top..bottom, read off `getBoundingClientRect` after the
scroll. "Shell scroll" is `main.appShell`'s own `scrollTop`.

| viewport | before: shell scroll | before: bar | before: rows under the bar | after: shell scroll | after: bar | after: rows under the bar |
| --- | --- | --- | --- | --- | --- | --- |
| 390x844 | 0 | 722..779 (sheet footer, above the tab bar lane) | none | 0 | 722..779 | none |
| 768x1024 | **403** | **490..555, mid-viewport** | **"Published price" £6.00 Listed** | 0 | 959..1024 | none |
| 820x1180 | 0 | 1115..1180 | none | 0 | 1115..1180 | none |
| 1440x900 | 0 | 835..900 | none | 0 | 835..900 | none |

## The cause, in three parts

The 641-768 venue drawer is the legacy inline bottom sheet: a viewport-tall
`.mapDrawer` translated DOWN by its snap fraction (45dvh at `half`), so 45dvh of
its scrollport hangs under the screen. Three things restated or ignored that.

1. **The map shell was a scroll container.** `main.appShell` was
   `overflow: hidden`, which no gesture scrolls but `scrollIntoView` (and a
   focus) does, and the translated drawer overflowed it by exactly the part
   under the viewport. One scrollIntoView on the price row scrolled the shell
   403px; the drawer's box moved up with it. It is now `overflow: clip`, which
   nothing can scroll.
2. **The sticky inset restated the translate.** `venueSheet.css` carried three
   dvh copies of the snap translate as the bar's `bottom`, right only while the
   drawer's box sat where the snap put it. `SpringDrawer` now publishes the px
   it translates by as `--drawer-sheet-offset`, and the 768 band in
   `app/globals.css` derives `--sheet-hidden-below` from it once (the per-snap
   dvh declarations beside the transforms are the fallback for the frame before
   the spring's first). The bar reads that one variable. The same band ends the
   scroll body with an `::after` spacer of that height, so the last row can
   reach the visible bottom; it is a spacer and not padding because Chromium
   measures a sticky inset from the scroller's content edge (measured: a
   `padding-bottom: 100px` on the scroller put a `bottom: 0` sticky child 100px
   up).
3. **The scroll container never said where its visible content ends.** A
   `scrollIntoView({ block: "center" })` centres on the scrollport, so at 768
   the centred row landed under the bar (838..992 against a bar at 959..1024).
   The drawer now declares `scroll-padding-bottom` as the hidden part plus the
   bar's height, at every width the bar is sticky.

## Fences

- `__tests__/tabletSheetInset.test.ts`: the shell clips, the offset is
  published and derived once, the spacer is content, the bar carries no dvh.
- `e2e/venue-sheet-tablet-command-bar.spec.ts`: at 768x1024 and 820x1180,
  signed in, scrollIntoView on every price row and the price door, a wheel from
  top to end, and a jump to the end. After every step the shell has not
  scrolled, the bar is within 24px of the bottom edge, and the row brought into
  view is not under it; at the end every price row sits above the bar.

## Two findings beside it

- The 641-768 band still reserves `--mobile-tab-clearance` (58px) for a phone
  tab bar that `components/nav/mobileNav.css` hides above 640px, so the map's
  bottom controls in that band sit 58px higher than they need to. The sheet's
  own geometry now subtracts that lane, so the bar is flush with the viewport's
  edge. The stale lane is not changed here.
- On a loaded rig the phone sheet portal mounts seconds before the mobile
  shell's CSS chunk arrives, and renders unstyled and unpinned until it does
  (`.mobileSheetPortal` computed `position: static`, the sheet parked below the
  viewport). The phone shots wait for the portal to read `fixed` before they
  are taken. Not changed here.
