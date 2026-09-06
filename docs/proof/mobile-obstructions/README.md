# Five obstructions a thumb met at 390, measured before and after

PlanAstra reviewed the product at 390 wide on 6 September 2026 and found
controls a thumb could not reach and messages that named the wrong reason.
Rows 6, 7, 12, 13 and 23 of section 2 of `data/reports/PlanAstra.md`, with
report sections 1.2, 2.4 and 5.1.

Every figure here was measured on a production build (`npm run build`, then
`npm run start`) against a local server on a private port, in Chromium at
device scale 1 with reduced motion. The "before" arm is the same build with
the fixes' own declarations reverted in the page, so both arms are one binary
and nothing but the rule under test differs.

## 1. The venue peek head: "Near m" under `Plan stop`

The row is `auto minmax(0, 1fr) auto`. The figure column takes its own
max-content, so a long standing line ("Logged once, needs a second drinker" on
one line, about 230px of a 358px row) left the phrase column - which had a
floor of ZERO - a few pixels. "Near me" is one unbreakable phrase, so it
overflowed its cell and ran under the control beside it.

Measured with that caption in place, in CSS pixels from the viewport's left
edge. `phrase` is the text's own right edge, `cell` its column's right edge,
`action` the left edge of `Plan stop`:

| width | arm | phrase | cell | action | inside its cell | under the action |
|---|---|---|---|---|---|---|
| 320 | before | 275 | 199 | 209 | no | **yes, by 66px** |
| 320 | after | 199 | 199 | 209 | yes | no, 10px clear |
| 390 | before | 298 | 269 | 279 | no | **yes, by 19px** |
| 390 | after | 244 | 269 | 279 | yes | no, 35px clear |

The prompt also dropped from 18.56px (`--text-md`, the figures size) to 16px
(`--text-base`): it is a location prompt, and at the figures size it read as a
second heading under the pub's own name.

Shots: `*/venue-peek-head-{320,390,768,1440}.png`. The head is a phone strip
(`@media (min-width: 641px) { display: none }`), so the 768 and 1440 frames
are the docked drawer and carry it not at all - they are here to show the
change reaches no width it does not own.

## 2. `/plan` after Sort it: the primary under the chrome

`Lock it in` is the last control on a form several screens long, so it landed
at the natural foot of the page: under the tab bar's reserved lane and under
the floating create action. Shots: `*/plan-sorted-{320,390,768,1440}.png`.

The before frame at 390 is the captain's own screenshot reproduced: the
primary half-covered by the tab bar, the `+` beside `Add another stop`. The
after frame has it as a full-width bar above the bar's own reserved lane, with
the trust line inside it, and the create action stood down.

Two more on the same screen, both visible in `before/plan-sorted-390.png` and
gone after: a second painted primary (`Make a plan`, now the quiet "Sort it
again" once a route exists), and "Skip to main content" rendered in flow
mid-page, which `before/venue-peek-head-390.png` catches at the top left.

## 3. The consent card at four phone heights

The duplicate control PlanAstra measured on `/u/you` was already answered on
main, the other way round from the brief: `lib/consentSurfaceRoutes.ts` makes
the account settings block the ONE consent control on the `/u/` family and
takes the arrival card away there.

What was still open is that the card was only ever proved at 390x844. It is
fixed and the first screen of a short phone is short, so it will always sit
over something at rest; what has to hold is that a reader can reach PAST it.
Measured on `/`, scrolled to the foot of the document:

| height | body foot reserve | card height | tappable controls left under the card |
|---|---|---|---|
| 568 | 192px | 116px | none |
| 640 | 192px | 116px | none |
| 844 | 192px | 116px | none |
| 932 | 192px | 116px | none |

`e2e/ux-consent-chrome.spec.ts` now sweeps all four.

## 4. Three mis-worded absences

No screenshot: each is a sentence, and the proof is the branch that chooses
it. `__tests__/wordedAbsences.test.tsx` holds all three, and the shapes are:

- `/plan/[id]` said "This plan has closed" over a live plan whenever the store
  could not be reached. `planStore().read` is three-way now.
- `/near` said "We haven't mapped pubs in Clapham yet", with a form asking us
  to map it, whenever the priced shard read failed.
- A 4.5 MB photo passed a 5 MB browser gate and came back as the platform's
  own plain-text 413. Both map composers and the server cap read
  `lib/uploadBodyLimit.ts` now; the figure was 5 MB in three places and the
  platform refuses anything over 4.5 MB before a handler runs.

## 5. `Copy invite link` under the floating `+`

PlanAstra could not click it in 30 seconds at 390: Playwright resolved the
control and reported it obscured. `/plan/[id]` carries `pageHidesCreateFab`
now, and `e2e/plan-invite.spec.ts` resizes the host's own locked plan to 390
and asks who owns the point at the button's centre.

## One thing found on the way and fixed here

`e2e/a11y-core-journeys.spec.ts` reported a serious contrast violation on
`/map?sel=` at 1440 light: `.saveToListToggle` printed `--brass` as a WORD on
a 7% tint of itself. That is the accent law this repo already wrote down
("coral is a fill and coral is a word, and those are two tokens"), so the two
controls under that rule read `--brass-ink`. It is pre-existing on main and
touched by neither open PR.

```sh
NEXT_DIST_DIR=.next-mobobs npm run build
NEXT_DIST_DIR=.next-mobobs npm run start -- --port 3170     # plus the keyless env
PW_PORT=3170 PW_SKIP_WEBSERVER=1 npx playwright test \
  e2e/mobile-venue-sheet-tabs.spec.ts e2e/mobile-plan-flow.spec.ts \
  e2e/ux-consent-chrome.spec.ts e2e/plan-invite.spec.ts --project=chromium
```

## What was red on main at this branch's base, and stayed red

`1326ca341` is the base commit, and its own CI run (34050621997 / 34050621906)
fails these for the same reasons. None is touched by this branch.

| job / spec | cause | who owns it |
|---|---|---|
| Production build | `/today` prerenders, reads the weather snapshot store, and `selectStore` refuses a memory fallback on a runner with `NODE_ENV=production` and no Supabase keys | PR #1589, which adds `isProductionBuildPhase()` and names this failure in its own test |
| Performance budget | `fatal: could not read Username for 'https://github.com'` fetching main for the ratchet | the runner's git credentials |
| `smoke.spec.ts:344` | waits for an "add a price" button in the sticky Venue actions toolbar, which #1517 removed - `e2e/mobile-venue-sheet-tabs.spec.ts` asserts the opposite of the same toolbar | the overview-price-door lane |
| `mobile-venue-sheet-tabs.spec.ts` "a real 390px touch swipe" | expects `data-trailing-fade="on"`; measured in both arms the phone strip computes `flex-wrap: wrap`, `overflow-x: visible`, `scrollWidth === clientWidth`, two rows, so nothing is past the edge | whoever owns that wrap |
| `mobile-button-system.spec.ts` "/tonight keeps its right cell clear" | asserts `.tonightSoftPlansLink` unconditionally, but `app/tonight/page.tsx` mounts that module only when `isQuietPintWindow(now)` - a server-side London-clock gate | needs an argued row in `e2e/conditional-skips.allowlist.json` |

One regression this branch DID introduce and CI caught:
`plan-held-acceptance` went red because the first cut of the demoted concierge
control asked the STOPS whether a route was on the page, and a held acceptance
seeds Stop 1 with no route. Fixed in `bc67c806a`.

## Reproducing

`/api/plans/generate` is limited to 8 per minute per address
(`RATE_LIMIT_MAX`), and the plan specs spend two each, so run them serially
and leave a minute between repeats: a run that exhausts the window fails at
"Route refreshed" with nothing wrong in the tree.
