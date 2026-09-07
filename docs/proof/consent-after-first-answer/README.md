# The consent card arrives after the answer, and it is docked

Captain's standing ask over PlanAstra section 3: "the primary asks before it
gives" is wrong, the product answers first. The report's own words:

> The analytics consent card is the first thing a new reader meets on every
> route, at every width, before the answer. It covers the first listing at
> 360x640 on Tonight, the rail on the landing at 320x568, the city list on
> Places, and the Founding hundred on Social ... until answered it sits over the
> fold on the smallest phones.

Two halves were wrong and both are fixed: WHEN the card mounts, and WHAT SHAPE
it is when it does.

## What changed

| | Before | After |
| --- | --- | --- |
| Mounts | On the first paint of every route | Only after the product has answered this reader once (`lib/consentAnswerMoment.ts`) |
| Shape | Inset panel, rounded, shadowed, `backdrop-filter: blur(14px)` | Full-bleed strip, square, opaque, one hairline on its top edge |
| Berth (phone) | 8px above the tab bar | Flush on the tab bar's own reserved lane |
| Prompt budget | Claimed at first paint | Unclaimed for the whole wait |
| `/u/you` signed out | Two Allow / No thanks pairs on one screen | None: the ask defers to the next route |

## What counts as an answer

A closed set, in `lib/consentAnswerMoment.ts`:

- `venue-sheet` — a pub's own sheet is on screen. It rides
  `components/map/useVenueSheetOpened.ts`, which AGENTS.md already holds as the
  ONE emitter of that moment for both pub layers, so the pin tap and the sheet
  open cannot answer differently.
- `pal-reply` — Pub Pal put an answer in the transcript. It rides the ANSWER,
  never the ask: a question nobody has replied to is still the reader waiting.
- `second-route` — the reader reached a second distinct route this session,
  which is what a list-item tap, a card link and a tab all come out as. Recorded
  by the card from the live pathname rather than by every list in the tree.

The marker is one word in sessionStorage. Nothing here is analytics: no beacon,
no identifier, and the analytics rail stays exactly as consent-gated as it was.

## Measured

`e2e/consent-after-first-answer.spec.ts`, Chromium, production build, 320x568
and 360x640, 12 cases, all passing:

- No card on the first paint of `/`, `/tonight`, `/places` or `/social`, held
  absent for 1.5 s after the route's own answer rendered, with the session's one
  interruptive slot still unspent.
- The card appears after the reader reaches a second route, and its box does not
  intersect the first listing's box.
- It is docked: `x <= 1`, width `>= viewport - 1`, its foot on the reserved
  tab-bar lane to within 1px, `backdrop-filter: none`, `box-shadow: none`,
  `border-radius: 0`.
- No request to `/api/events`, the `/ingest/` proxy, `/_vercel/insights` or
  posthog.com before Allow is tapped.

`e2e/ux-consent-chrome.spec.ts` (26 cases) and the full unit suite (16,137
tests) are green.

## Cumulative Layout Shift, /tonight at 360x640

Layout-shift observer over a production build, three timing arms in one run.
The third arm seeds the answer moment, which reproduces the retired behaviour
exactly: the card mounts on the first paint of the route.

| Arm | Card on screen | CLS |
| --- | --- | --- |
| `/tonight` as the first route | no | 0.01590115017361111 |
| `/tonight` as the second route | yes, docked | 0.01590115017361111 |
| `/tonight` with the old timing | yes, on first paint | 0.01590115017361111 |

Bit-identical to seventeen digits across all three, so the consent card
contributes ZERO shift on this route in every arm. The 0.0159 that remains is
/tonight's own, and AGENTS.md already attributes it: the Tonight primary block
and the soft-plans section under it at the moment the listings replace the idle
reservation. It is not comparable to the 0.009 in `perf/cwv-baseline.json`,
which is taken at 390x844 on the sweep's own throttled rig.

No dependency was added.

## One deviation from the brief, stated

The brief asked for the card to dock "under the header on desktop where there is
no bottom bar". This site's desktop header is an IN-FLOW pill
(`.siteNavBar`, `components/nav/siteNav.css`), not a fixed bar, so a card fixed
under it would overlay page content as soon as the reader scrolled, and
reserving a `padding-top` lane for it would push the whole document down at the
moment it mounted. Desktop therefore keeps the foot of the viewport, now
full-bleed and docked rather than an inset floating panel, with the existing
`--analytics-consent-clearance` reserve unchanged. A top dock is a CSS
follow-up if the captain wants it and a sticky header lands with it.
