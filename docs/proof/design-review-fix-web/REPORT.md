# Design review of the web surfaces

Branch `fm/design-review-fix-web`. Each surface is opened in a production build at 320x568, 390x844, 768x1024 and 1440x900, light and dark, signed out and signed in, every control is clicked, and every defect above a nit is fixed in a commit with a before and after under `docs/proof/design-review-fix-web/<surface>/`. The design law applied: `app/globals.css` owns the tokens, `docs/DESIGN_SYSTEM.md` and `docs/VOICE.md` own shape and words, one shape family per surface with its neighbours, no decoration without information, the price band law and trust by label untouched, reduced motion respected.

Method: a Playwright sweep (`chromium`, device scale 2, reduced motion) shoots each width, theme and sign-in state and records an audit of every control under 44px, every overlapping pair of controls, clipped text and horizontal overflow; the shots and the audit are read together, then each control is driven by hand.

## Surfaces

| Surface | Defects found and fixed | PR | Nits left, with the reason |
| --- | --- | --- | --- |
| `/` | No primary navigation from 641px to 960px (links hidden under 960, dock only under 641). City chooser: coral dash kicker at 10.88px in raw `--brass` on light (2.5:1), coral search icon, coral-tinted locate pill beside the answer card's plain `Near me` for one action, 8% coral wash on twelve city cards. Create action over a phone city card's tagline. Arrival toast dismiss 28px. | #1597 | The arrival toast sits over the landing kicker for 4.2 s at 390 (it leaves on its own; docking it at the foot collided with the compose action and the price-submission spec's contract). The consent card covers the answer card at 320 and 360: a flow decision, raised as `consent-before-answer`. `Still £6.50?` as the first primary for a stranger is PlanAstra section 3's redesign, not a defect this lane takes. |
| `/map` and the venue sheet | First-visit card beside the suggest banner, the Tonight card and the Pub Pal chip at 768 and 1440 (twenty controls). Empty `New round here` panel. Drawer photo on a grey band at 1440. Seven tabs wrapping at 1440. Kicker wave icon. Zoom pair under the sheet's top edge at 768. | #1597 | Kind chips row at 641px and up belongs behind a desktop `Filters` control (PlanAstra 9), a new control with spec coverage to move: raised as `map-kind-chips-behind-filters`. The phone tab strip wraps to two rows by a recorded ruling (every section on screen). The first-visit card's inverse-fill primary stays because the toolbar's `Plan an outing` is the map's one coral. The price plaque and the `Near me` head row are PR #1591 and #1594. |
| `/near` | `Change area` and `Try my location again` in a second text-button family. Caps column caption. `More areas` at 36px. | #1597 | Patch chips keep the pill (a chip). The consent card over the chips at 320 is the same flow decision as above. |
| `/today` | Stale weather day printed twice. Stale wash in the action accent rather than the caution token. | #1597 | Picks copy `Some listings could not be checked. · Couldn't reach tonight's listings just now.` joins two sentences; `lib/picksState.ts` is PR #1587's. Arrow icons on the way-onward links are one family within the cards and are left. |
| `/tonight` | Create action over every soft plan row's arrow at 390 signed in. Caps `No event needed` label. | #1597 | Same picks copy as `/today`. At 1440 the keyless build shows one column because the Deals and Music lanes hold no rows; not reproducible without listings. |
| `/plan` | Walked, including after `Sort it`. | none here | `Lock it in` under the tab bar, two painted primaries and the in-flow skip link are PR #1594. The stop row (a `Venue name` label over a read-only field, `Swap · 2` and `Remove` stacked, 1,400px for three stops) is the follow-up after #1594 lands, because #1593 and #1594 both touch `PlanComposer.tsx` and `plan.css`. `/plan/<id>` needs a locked plan, which the keyless build cannot mint without the auth doubles; walked in the next pass. |

## The CI flake firstmate sent

`e2e/mobile-map-chrome-fit.spec.ts` › `320px keeps the whole place name and the map-edge lane tappable` failed once on the Avrea runner (run 34064821878, attempt 1) and passed on retry. The attempt-1 log names the assertion: one animation frame after the CDP safe-area override, the TfL control still measured its default berth (308 against 288). The pin now waits, bounded, for the inset to land and asserts the same edges. Fixed in #1597.

## Decisions raised

- `consent-before-answer`: the consent card is the first thing a new reader meets at 320 and 360, over the answer card on `/` and the first list on `/near` and `/tonight`. PlanAstra section 3 moves it to the third screen. Flow change; the captain's call.
- `map-kind-chips-behind-filters`: PlanAstra item 9. Needs a desktop `Filters` control and moves the specs that click the chips.
