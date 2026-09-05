# UI sweep, 5 September 2026

Every route below was walked on a **production build** at three widths in both
themes, and each screen shot before and after the fixes in this branch. The
numbers each fix quotes were read off the rendered page with
`getBoundingClientRect`, never off a stylesheet and never by eye.

- `before/<width>-<theme>/<route>.png`
- `after/<width>-<theme>/<route>.png`

Widths: 390x844 (phone), 768x1024 (tablet), 1440x900 (desktop). Themes: light
and dark. Routes: `/`, `/map`, `/map?sel=<venue>`, `/tonight`, `/today`,
`/near?patch=soho`, `/out`, `/places`, `/plan`, `/pal`, `/social`, `/u/you`,
first-run onboarding and the account hub.

## How it was driven

`chrome-devtools-axi` could not drive this machine: it looks for Google Chrome
at `/Applications/Google Chrome.app` and no Chrome is installed here, so it
refuses with `Could not find Google Chrome executable`. The walk therefore ran
on the same engine through Playwright's own Chromium, against
`npm run start` on an isolated `NEXT_DIST_DIR` production build with the
Playwright `webServer` environment, so the keyless routes answer.

## What was measured, not eyeballed

Each pass ran four sweeps over every page:

1. horizontal overflow of the document and of every painted element;
2. text clipped by an `overflow: hidden` box with no ellipsis;
3. an interactive element whose own centre point belongs to something else
   (`document.elementFromPoint`), which is what "covered" means;
4. controls under the 44px thumb floor, broken images, and empty `main`s.

Two further sweeps answered the two classes the captain added: every
button-like control's height, radius, padding and type scale, grouped to find
the outliers; and, for every circular control holding one child, the child's
centre against the control's.

## Second pass, later the same day

The after set was re-read against the branch and seven further defects were
fixed, each with its own commit and each measured on the rendered page:

| Route | Width | Defect | Fix |
| --- | --- | --- | --- |
| every route | 641 to 900 | the top bar's action cluster sat over Out, Social and You (0px between More and "You" at 768px, 163px of overlap at 641px) | `components/nav/siteNav.css`, `components/nav/siteNavMoment.css`: More drops its label, the palette hint pill goes, gaps tighten, the compose dot leaves between 641px and 767px |
| /today, /tonight | 390, 768, 1440 | the Day and Tonight segment sat on the bar (0px gap at 768px and 1440px) | `components/nav/nowSegment.css`: 16px on a phone, 24px above 640px |
| /map?sel= | 1440 | the venue name, kicker, photo and tabs sat at 801px in an 800px drawer while the address sat at 819px | `components/map/venueSheet.css`: the inspector carries the 18px inset, the panel pads only vertically |
| /u/you | 390 | the identity heading broke across the 72px face in a 230px column | `app/u/[handle]/profile.css`: the card stacks |
| /pal | 390 | the kicker sat 16px under the top of the viewport | `app/pal/pal.css`: 1.75rem over the safe area |
| /map?sel= | every width | "No photo yet" was a warm gradient band that read as a failed image | `components/media/venueImage.css`, `components/map/venueSheet.css`: a flat surface with a hairline and an icon |
| /tonight, /near, /map?sel=, /u/you, /pal | every width | one secondary wore five radii, four type sizes and three weights; the sheet primary wore a gradient and a glow; the Pal primary had lost its weight to a `font` shorthand; a booking link was dashed; the Lore door was an outlined coral box | `app/globals.css` control tokens, read by every one of those classes |

The fences for all seven are in `e2e/mobile-button-system.spec.ts`.

`map-story` is the landmark chapter sheet (`/map?landmark=covent-garden`). It
belongs to the story-sheet worker and is captured here only so the set is
complete; nothing in this branch changes it. `onboarding` needs the native
first-run handoff in session storage plus a Capacitor shim, which the sweep
script sets; `account` is `/u/you?tab=account` signed out, because the
keyless build has no session to sign in with.

## Result of the centring sweep

No off-centre icon at any of the three widths: every circular control's single
child sits within 1px of its centre in both axes. That sweep is now a fence in
`e2e/mobile-button-system.spec.ts`, so the next one is caught.
