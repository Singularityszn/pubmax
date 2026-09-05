# Trusted-handoff flags: what a reader gets now

Review finding P0-3. Three trusted-handoff rollout flags were set to `1` by the
CI browser matrix and by no deployment, so CI proved behaviour no reader had.
All three are deleted and the flag-on behaviour is the only behaviour.

| Flag | What production did before | What production does now |
| --- | --- | --- |
| `PUBMAX_MAP_ROUTE_TRANSFER` | "Open Plan to lock it in" navigated to `/plan` and Plan regenerated the route from scratch. | The same link writes the exact captured Route into the Plan draft on the click, so Plan hydrates the same stops, order, anchor and grounding proof. |
| `PUBMAX_TONIGHT_GROUPING` | `/tonight` and `GET /api/whats-on` grouped with the schedule-blind key, first-appearance order and no diversity cap. | The canonical model: the group key carries the normalised schedule, groups take the deterministic locality tie-break, and no family fills more than two of the first ten slots. |
| `PUBMAX_PAL_HANDOFF` | A Pub Pal answer card carried the browse deep-link alone, with no locality line and no acceptance. | Every answer card with a venue carries "Use this Venue" into `/map?sel=...&accept=1&src=pal`, the locality line renders, and the chat's way onward is "Back to your Pub Pal". |

## Shots

Taken against a local production build (`npx playwright test`, chromium,
`PUBMAX_E2E_KEYLESS=1`) on this branch.

- `tonight-390.png`, `tonight-1440.png` - `/tonight` over a fixed What's-On
  spine (two venues running one deal, plus a music and a quiz row). The deal
  family collapses to one card carrying "Same deal at 2 pubs", which is the
  canonical grouping doing the work the flag used to gate.
- `map-to-plan-390.png` - the Map-to-Plan transfer button, after the phone
  planner generates a route on `/map`.
- `map-planner-1440.png` - `/map?plan=1` at 1440. The transfer button has no
  1440 shot because it has no 1440 surface: `MobilePlanActivation` mounts only
  under `mobileViewport`, so at desktop widths the planner rail is what a reader
  gets, and this shot is that rail. Nothing about that changed here.

## What a verifier should re-check

1. `/tonight`: one card per offer family, an expander reading "Same deal at N
   pubs", and no family more than twice in the first ten rows.
2. `/map` at phone width: describe an outing, generate, then follow "Open Plan
   to lock it in" and confirm Plan opens with the same stops in the same order
   rather than regenerating.
3. `/pal/chat`: an answer card with a venue offers "Use this Venue", and the
   secondary link reads "Back to your Pub Pal".
