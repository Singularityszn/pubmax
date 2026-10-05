# Red on main

The chromium browser suite was red on `origin/main` `aa6470eec` with 197 stable failures on a keyless production build. This file tracks the repair, one root-cause group at a time. The source is the merge gate report of 13 Sep 2026 (`data/merge-gate-13sep/report.md` in the agent workspace, sections "Main is red" and "Appendix").

The repair branch starts at `8a942142c`. A red from the appendix is reproduced on this branch before it is fixed.

## Rules

- A spec that lies about the shipped product is fixed to match the product.
- A product bug that a spec correctly catches is fixed in the product, and the spec stays.
- No `test.skip`, no deleted test, no timeout wider than the idioms in `e2e/AGENTS.md`.
- A group is ticked only after a targeted run of its specs on the rig passes.

## Groups by real root cause

The appendix groups G1 and G2 are coarse. The groups below are by spec file or by product change. A tick means green on the rig.

- [x] R1 `mobile-bottom-nav.spec.ts` (5 fixed): the specs lied about the shipped product.
  - `:46` opened the planner through `More map controls` then `Plan an outing`. On a phone the planner opens from `Describe the outing`, and `More map controls` holds layers only.
  - `:65` looked for a `searchbox`. The map search field is a `combobox` named `Search pubs`.
  - `:89` looked for an `Out` heading. `/out` opens on the Screen primitive with the h1 `What’s on, sourced.` (#1402).
  - `:99` looked for a `Cancel` link. Moment's secondary action is `Back` (#1402).
  - `:111` said gated Social stays out of the tab row (#1170). #1247 revived Social as one of six tabs, so the loop matched the spec to that bar. Main's #1655 then took Social out of the primary tab row (`components/nav/navigationModel.ts`, `__tests__/mobileTabBar.test.ts`). The merge keeps main's test, which expects no `/social` link, and main's Tonight tab test.
- [x] R2 `mobile-map-shell-matrix.spec.ts` and `view-mode.spec.ts` (11 fixed): the specs lied about the shipped map shell.
  - `mobile-map-shell-matrix.spec.ts` "coordinated map shell" (8 tests) expected 4 tabs. The bar has six. After the #1655 merge they are Tonight, Map, Places, Out, Plan, You (`components/nav/navigationModel.ts`).
  - The same tests then met four more stale steps, one after the other:
    - The map utility corner holds 2 buttons, TfL and the Near me FAB (`MapEdgeControls`), not 1.
    - The Near me sheet close is `Close Near me`, not `Close Cheapest listed near you`.
    - The shared sheet is as tall as its tab body, so the theme-toggle box check now reads the Layers tab after `sheet-entering` ends. Before, it compared the Key tab with the Layers tab.
    - The venue list opened from Map controls closes with `Close and return to the London map`, not `Close venue list`.
  - `mobile-map-shell-matrix.spec.ts` "London basemap hierarchy" (2 tests) wrote the camera only to `pubmaxx.mobile-map-session.v1`. The map resume cache `map-resume:v1:london` (`lib/mapResume.ts`) wins on reopen, so the map opened at zoom 12. The spec now writes the camera to both stores, as the map does.
  - `view-mode.spec.ts:7` expected no Social tab and no current tab on `/feed`. `/feed` redirects to `/social`, a Social alias, so Social is the one current tab.
- [x] R3 `social-composer.spec.ts` and `messages-desktop.spec.ts` (18 fixed): the launch Screen primitive moved each route's one door (#1402, #1597), and the composer spec caught a real product bug.
  - `social-composer.spec.ts` (10 tests) looked for a `New post` button. On `/social` the composer trigger is the Screen's primary action, `Post`. The dialog's own submit is also `Post`, so the spec now finds the submit inside the dialog.
  - `messages-desktop.spec.ts:105` (8 tests) expected a sign-in link inside the signed-out inbox card. The Screen head's primary `Sign in` is the one door to `/login`, and the card carries no second copy. The spec now checks the title and line fit, the card has no link, and the head's `Sign in` keeps its `from` path.
  - `social-composer.spec.ts:230` then failed on the product. When a second tab opened `/social`, the first tab closed its open composer, so no tab could say "This draft is open in another tab." The second tab's same-account `SIGNED_IN` broadcast re-ran the canonical identity read, and `syncDeviceHandle` announced a device identity change for the same handle. Any cross-tab `storage` write (the auth token, the auth lock, the device session list) did the same through `subscribeDeviceIdentity`. `/social` re-asked for access on each notice, and the composer unmounted while it waited.
  - Fixed in the product: `syncDeviceHandle` announces only a changed handle (`lib/identityClient.ts`), and `subscribeDeviceIdentity` re-reads only on a `storage` event for the identity set, the owner stamp or a clear (`lib/deviceAccountIdentity.ts`). Pins: `__tests__/identityClient.test.ts`, `__tests__/deviceAccountIdentity.test.ts`. `e2e/account-switch-identity.spec.ts` stays green.

- [x] R4 `mobile-v1-obstructions.spec.ts` and `mobile-venue-sheet-tabs.spec.ts:385` (13 fixed): four causes. Two were product bugs.
  - Install prompts (5 tests). The spec waited 10 s for the card, but `DeferredShellExtras` holds every shell prompt for 30 s unless `pubmax:e2e-defer-shell:v1` is `now`. The spec now sets that key, as the other map specs do. The spec also wrote the analytics choice to `pubmax:analytics-consent:v1`. The real key is `pubmaxx:analytics-consent:v1` (`lib/analyticsIdentity.ts`), so the consent prompt could take the prompt budget first.
  - The non-modal card check counted every `aria-modal` dialog. The venue sheet that `?sel` opens sits at half, which is modal by design (`lib/mobileSheetA11y.ts`, #760). The check now counts only the install surface.
  - Product bug: the Android install card did not answer a tap in about 2 of 3 page loads. The half venue sheet's `map-surface` focus trap scans body siblings once and sets `inert` on them. A card that mounted before the sheet opened was made inert, so a tap fell through to the sheet. Fixed: `shouldInertOutsideSibling` spares `.a2hsSheet--android`, as it spares the tab bar and account setup (`lib/useFocusTrap.ts`). Pin: `__tests__/focusTrapVisibility.test.ts`. Proof: the install tests passed 24 of 24 on a 4x repeat.
  - Today tab-bar reserve (3 tests). Since #1302 the body reserves the create action's lane (`--float-stack-top-create`, 132px), not only the tab bar, so the spec now reads that published lane. The spec also caught a product bug: `.todayPage` added a second tab-bar reserve (88px) under the foot (#953). Fixed: its bottom padding is content spacing only (`app/today/today.css`). `app/tonight/tonight.css` has the same double reserve and is left for its own group.
  - Venue tab rail (4 tests). #1563 wraps the tab rail on a phone, so every tab is on screen with no overflow and no fade. The phone tests now check the wrap, and the swipe test taps the final tab with no swipe. The fade test moved to the 900px inline drawer, where the rail still scrolls. There it caught a product bug: `scrollIntoView` stopped 4px short of the end, so the fade stayed on over a fully visible last tab. Fixed: `.venueTabs` sets `scroll-padding-inline: 4px` to match its padding (`components/map/venueSheet.css`).

- [x] R5 consent answer moment, cold map and first-run tour (7 fixed): the specs lied about the shipped product.
  - `analytics-consent.spec.ts` (4 tests) and `map-filters-bottom-nav.spec.ts:32` waited for the consent card on first paint. Since #1604 the card waits until the product has answered (`lib/consentAnswerMoment.ts`). The specs now seed the answer moment, as `ux-consent-chrome.spec.ts` does. The wait itself stays owned by `e2e/consent-after-first-answer.spec.ts`.
  - `analytics-consent.spec.ts:54` also read `PUBMAXXING uses optional analytics`. Painted chrome names the brand, so the card reads `PUBMAXX uses optional analytics` (`__tests__/analyticsConsentPrompt.test.ts`).
  - `analytics-consent.spec.ts` "map prompt leaves the primary planning control usable" and `ux-consent-chrome.spec.ts` "never covers the tab bar" opened a cold map. The consent card paints first, then the First visit card mounts when the pins reveal, and consent yields to it by design (`mapFirstVisitArrivalBlocksConsent`, `lib/mapFirstVisitArrival.ts`). The box read then found no card: the tab bar test failed 3 of 4 runs. Both tests now open a map that has had its first visit. Proof: 8 of 8 on a 4x repeat.
  - `mobile-first-run-tour.spec.ts:33` and `first-run-tour-placement.spec.ts:5` waited 10 s for the tour, but `DeferredShellExtras` holds it for 30 s unless `pubmax:e2e-defer-shell:v1` is `now`. Both set the key. The tour legend also moved to the area thresholds, so `Over £7` is now read through `priceBandLegendLabel("expensive")`.
- [ ] R6 native first run (12 tests), parked under "Needs captain": `ux-consent-chrome.spec.ts:390` (6), `mobile-first-run-onboarding.spec.ts:110` (2), `:148`, `:231`, `price-caption-integrity.spec.ts:498` (2). `mobile-first-run-onboarding.spec.ts:210` fails the same way on this branch.
  - Spec half, fixed: the specs stubbed `window.Capacitor` with a bare `isNativePlatform`. Since #1599 a native page imports `@capacitor/core` (`lib/nativeSystemBars.ts`), and core writes its own `isNativePlatform` onto that object from the real bridge. A browser has no bridge, so the stub turned to web a moment after hydration. `e2e/helpers/nativeShell.ts` now also sets `window.CapacitorCustomPlatform`, core's seam for a platform with no bridge. All three specs use it.
  - Product half, not fixed: see "Needs captain".
- [x] R7 the bill on every priced write (14 fixed): the specs lied about the shipped price doors. `price-evidence-missions.spec.ts` (8, including the two G3 `/near` tests), `price-submission.spec.ts:314` and `:577`, `one-tap-measure.spec.ts:89` and `:149`, `claim-no-birth-date.spec.ts:269`, `second-drinker-confirm.spec.ts:159` (listed as G3, but it fails in the same way on every run).
  - Since #1630 a priced write carries the bill, so `lib/communityContributionClient.ts` posts a multipart form. The route doubles read the body with `postDataJSON()`, which throws on a form, so the write never answered. `readPriceSubmission` in `e2e/helpers/priceBill.ts` now reads the form or the JSON (a venue signal carries no photo), and gives `priceGbp` back as a number.
  - The two `/near` mission tests attached the bill before the mission's own `Log it` opened the composer. The bill's picker lives in that composer, so the bill now goes on after it opens.
  - The missions double answered a beer write with no `pintTrust`. Since #1551 (D07) a beer receipt reads the pint lane's trust as the route read it, and with no read the receipt says `Logged.`. The double now answers `pintTrust: "logged-once"`, as the route does for one report.
  - `price-evidence-missions.spec.ts:358` asked for the only radiogroup in the composer. The beer lane also asks the measure in its own radiogroup (#1570), so the spec names the drink group.
  - `second-drinker-confirm.spec.ts:159` attached the bill with the one-tap helper. `Still £4.50?` opens the Pint Drop composer, so it now uses `attachSpillBill`.
  - Proof: the five spec files gave 40 passed on a 2x repeat, and the other bill specs (`price-bill-required`, `spill-composer-keyless`, `price-two-drinkers-receipt-proof`, `contribution-age-door`, `second-drinker-confirm`) gave 26 passed on a 2x repeat.
- [x] R8 Tonight (8 fixed): `tonight-share-failure.spec.ts:9` (2), `tonight-trusted-ui.spec.ts:191` and `:224`, `tonight-vibe-chips.spec.ts:18` (2), `tonight.spec.ts:650`, `mobile-tonight.spec.ts:31`. One product bug and four stale specs.
  - Product bug: the keyless production server answered every `/api/whats-on?pubOnly=1` read with `error: "Could not check listings."`. `whatsOnListingStore()` asked `isDeployedProduction()` directly, so it skipped the `PUBMAX_E2E_KEYLESS` escape that `requiresSupabaseStore()` owns for every other store, and answered the unavailable store. `/tonight` then showed "Some listings could not be checked." and no vibe chips. Fixed: the store asks `requiresSupabaseStore()` (`lib/whatsOnListingStore.ts`), so a real production process with no Supabase still answers the unavailable store. Pin: `__tests__/whatsOnListingStore.test.ts` "whatsOnListingStore selection" (red on the old code, green on the fix).
  - `tonight-share-failure.spec.ts` looked for the share status in `.tonightEyebrowRow`. Since #1575 Share sits in `.tonightHeadCredits` under the listings. The spec now reads the status there, checks that the block follows the lede region, and retries the tap for hydration.
  - `mobile-tonight.spec.ts:31` wanted the heading "What's on near you". A reader with no shared or remembered area gets "What’s on across London tonight." (`tonightHeading`, `lib/tonight.ts`).
  - `tonight.spec.ts:650` scoped "no chain leads" to `.tonightPrimary`. Since #1627 the Wetherspoon block sits inside that element under its own name, below the lede. The spec now scopes to the lede region (`data-testid="tonight-lede"`), as `app/AGENTS.md` defines it.
  - `tonight-trusted-ui.spec.ts:191` held the first listing row above the tab bar (#1575). Since #1627 the hyped pubs lead the lede region, so the first row is at y=1731. The spec now holds the lede's first entry above the tab bar and the list inside the lede. The pin sentence in `app/AGENTS.md` says so.
  - `tonight-trusted-ui.spec.ts:224` wanted no "Checked 24 Jul" on the page (the mocked `servedAt`). The hyped pubs pack has its own real credit dated 24 Jul (Simmons), so the spec now counts only a stamp outside `.tonightHyped`.
  - Proof on the rebuilt rig: the 5 spec files gave 24 passed on a 2x repeat.
- [x] R9 `launch-phone-controls.spec.ts:116` (6 fixed): the spec lied about the shipped product. Two causes.
  - `/about`, `/discover`, `/pubs`, `/login` and `/messages` reported `skipLink 1x1` under the 44px floor. Since #1594 the skip link hides with the visually-hidden idiom (a 1px box with `clip-path: inset(50%)`, `components/a11y/skipLink.css`), so no thumb can reach it until it is focused. The sweep now counts that idiom as invisible. `e2e/mobile-plan-flow.spec.ts` still holds the focused skip link's geometry.
  - `/social` waited for `.findLot__ghost`. That link ("Sign in to follow") renders only beside a handle search match, and a signed-out page with no query has none. The invite door a signed-out reader meets is `.findLot__follow` ("Sign in to invite", `components/social/FindYourLot.tsx`), so the spec now waits for and measures that door.
  - Proof on the rig: the spec and `mobile-plan-flow.spec.ts` gave 14 passed on a 2x repeat.
- [x] R10 the 7 Sep landing rebuild and the #1631 map chrome cut (6 fixed): `mobile-button-system.spec.ts:28` (4), `:378`, `qa-button-sizing.spec.ts:24`. Three stale specs and two product bugs.
  - `mobile-button-system.spec.ts:28` counted the primary plus `LANDING_QUIET_DOORS`. Since the 7 Sep rebuild the receipt door (`Still £6.50?`, or `Log what you paid` with no card) leads the quiet row, before the static table (`components/landing/LandingHero.tsx`, pinned by `__tests__/landingFindMyPintHierarchy.test.ts`). The spec now counts the receipt door, checks its label, and reads the table from the second quiet door.
  - `mobile-button-system.spec.ts:378` waited for `.mapFitLondonBtn` on the map. Since #1631 Show all lives in the Layers popover. The spec opens Layers, finds Show all there, and closes Layers before it reads the zoom pair's centre points.
  - `qa-button-sizing.spec.ts:24` measured `.mapToolbarDesktopExtras .favoritePintControl` and the map-edge Show all. #1631 moved the pint brand into the drink lane's panel and Show all into Layers (`components/AGENTS.md`), so the spec now opens each home and measures there.
  - Product bug: from 641px up, the open drink panel had no pint brand picker and no persona lens. `.mapToolbarDrinksLens` kept a `display: none` from when the row carried its own brand copy, and #1631 deleted that copy. Fixed: the rule and its phone override are gone (`components/map/mapToolbar.css`). Pin: `qa-button-sizing.spec.ts`, which measures the brand control in the open drink panel at 1440.
  - Product bug: Show all and the compass were 40px tall in the Layers popover, under the 44px floor they held on the map edge. Fixed: `.mapLayersView` keeps `min-height: 44px` (`components/map/mapLayersControl.css`). Pin: `qa-button-sizing.spec.ts`, which measures Show all in the open Layers popover.
  - Proof on the rebuilt rig: both spec files gave 66 passed on a 2x repeat. `drink-chip-controls`, `map-desktop-arrival-chrome`, `map-desktop-filters`, `desktop-map-rail`, `drink-brand-landing` and `map-story` stay green, except the separate appendix reds `drink-chip-controls.spec.ts:188` (zone row regex) and `map-story.spec.ts:120` (Asahi row).
- [ ] R11 `desktop-map-chrome-fit.spec.ts` (8 fixed, 1 open): `:240` (4, one G1 and three G3), `:486` (G3), `:599` at 641, 800 and 1023 (3). The specs lied about the shipped product. `:311` stays red.
  - `:240` waited for the one `Clear search` in the toolbar. The toolbar's no-match status carries a second `Clear search` (`components/map/MapToolbar.tsx`), so the locator hit strict mode. The spec now finds the field's own clear control inside `.mapToolbarSearch`.
  - `:486` cleared storage and waited for the `Start with a story` overlay. On a clean first map the First visit card owns the ask, and the overlay goes about 1.1 s after it paints (`lib/mapFirstVisitArrival.ts`). The crawl button was detached under the tap. The spec now marks the card as answered, as the other map specs do.
  - `:599` at 641 to 1023 wanted the status in the left gutter. The left lane exists from 1024px up only (#1508, `components/map/mapBannerStaging.css`), because a 160px column broke the headline mid-word. Below 1024 the status stays centred under the prompt, which `mobile-button-system.spec.ts` "768px" also holds. The spec now checks that berth below 1024 and the left lane from 1024.
  - `:311`, spec half fixed: `getByRole("group", { name: "Venues" })` matches by substring, so it took the first row of "Venues across city maps". For "Soho" that row is Soho Foundry Tavern, Birmingham, and its tap opens `/map/birmingham`. The helper now asks for the exact name.
  - `:311`, still red: the planner is already at rest (-376) when the spec reads it "mid exchange". A frame probe on the rig shows 180 to 300 ms long tasks back to back for 2 to 4 s after the venue tap, so the 380 ms spring paints only 1 or 2 frames. The tap also takes 1 to 2 s to write `sel`. This is main-thread work after a venue select, not a spec defect. Load on the shared machine was 14 to 16, and the appendix says CI is red too. It needs a performance trace of the select path.
  - Leads found on the way, not fixed: (1) the toolbar says "No venues match ‘Shoreditch’ with your current filters." for about 1 to 3 s while the viewport shards for the query stream in, then clears. `searchSettled` is `loaded && loadedCityId === cityId` (`components/PubMap.tsx`), which is true after the opening shards only. (2) On a clean first map the story overlay paints, then yields to the First visit card 1.1 s later.
  - Proof on the rig: the spec file gave 32 passed and 2 failed on a 2x repeat. Both failures are `:311`.
- [x] R12 `mobile-shared-sheet-layout.spec.ts` (5 fixed): `:108`, `:163`, `:188`, `:219` light and dark. One product bug and three stale spec steps.
  - Product bug: a venue or the planner hides the phone tab bar (`components/nav/mobileNav.css`), but `.mobileSheetPortal` still stopped `--tabbar-h` above the bottom. The sheet floated 64px up over a strip of live map. #952 (8 Aug) clipped the portal above the bar and did not handle the hidden bar. Fixed: under `.appShell.detail-open` and `.appShell.planning-open` the portal reaches the bottom edge (`components/mobile/mobileMapShell.css`). The venue command bar and the sheet body already carry the safe-area inset. Pin: `mobile-shared-sheet-layout.spec.ts`, which measures the portal bottom while the tab bar is hidden.
  - The spec wanted the sheet `position: fixed` at the viewport bottom. Since #952 (QA H02) the sheet is `absolute` inside the fixed portal, so it cannot take a tab tap. The helper now checks that berth: the sheet meets the portal bottom, which is the tab bar's top when the bar shows (the Layers sheet) and the viewport bottom when it hides (venue, planner).
  - `:108` tapped Share and waited for `.venuePriceSubmit`. #1517 moved the price action out of the footer and left that wait behind. The spec now waits for the bar's own share answer in the footer.
  - `:188` (desktop) did not answer for the keyless Supabase host, so the realtime socket logged `ERR_NAME_NOT_RESOLVED`. It now uses the same stub as the phone tests. The error log now names the resource URL.
  - Proof on the rebuilt rig: the spec file gave 10 passed on a 2x repeat. Two earlier runs, started straight after other runs on the same IP, got `429` console errors in the last three tests. They did not come back after a pause, and a 16-load probe got no `429`.
  - Regression on the rig: `mobile-venue-sticky-actions`, `mobile-venue-sheet-tabs`, `mobile-map-shell-matrix`, `map-filters-bottom-nav` and `mobile-bottom-nav` pass (`mobile-bottom-nav.spec.ts:46` failed once in the 2-worker batch, then passed 3 of 3 alone). `mobile-map-list-obstruction.spec.ts:128` (2, G3) fails on its own stale step: it waits for `Close venue list`, and that list now closes with `Close and return to the London map` (see R2).
- [x] R13 `mobile-invite-map-prompt.spec.ts` (4 fixed): `:70`, `:211`, `:225`, `:250`. The spec lied about the shipped data pack.
  - Each test failed in 0 s with `TypeError: (intermediate value).slice is not a function`. The spec read `/data/venues_slim.json` as a bare array of venues. The pack is an object, `{ revision, rows }`, so `createInvite` now reads `rows`, as `plan-invite`, `plan-privacy-member` and `mobile-plan-recap` already do. No other spec reads the pack as a bare array.
  - `plan-invite.spec.ts:189` (G1, the same invite handoff) passes on this branch with no change.
  - Each test creates a Plan through `POST /api/plans`, which allows 8 per 60 s per IP (`app/api/plans/route.ts`, `lib/pintDrops.ts`). A 2x repeat in one window got `ok: false` from that create in 5 tests. Pace reruns of this file 65 s apart.
  - Proof on the rig: the spec file gave 4 passed on each of two runs 65 s apart.
- [ ] R14 `map-accessibility.spec.ts` (3 fixed, 1 open): `:195`, `:300`, `:383` are green. `:236` (now `:240`) stays open. One product bug and two stale spec steps.
  - Product bug (`:383`, and the Escape step of `:300`): a venue opened from List view keeps the list open under the desktop drawer. The drawer's focus trap makes the list inert, but the list's `useDismissOnEscape` still claimed Escape on `window`. So the first Escape closed the list out of sight and the drawer stayed up. The second Escape closed the drawer, and its Back reopened the list. Native Back dispatches the same Escape (`lib/nativeBackGesture.ts`), so it did the same. Fixed: `useDismissOnEscape` takes an optional panel ref and leaves the key alone when that panel is inside an inert subtree (`lib/useDismissOnEscape.ts`). `MapVenueList` passes its root. Pin: `__tests__/dismissOnEscapeInert.test.tsx`, red with the guard removed.
  - `:300` wanted Tab from the drawer's last control to wrap to `Close`. The drawer opened from List view leads its head with `Back to List view` before `Close` (`components/ui/surface-nav.tsx`), and the trap wraps to that first control. The spec now checks that the first control is Back and that Tab wraps to it. Initial focus on `Close` is still held.
  - `:195` looked for a `Bars` chip on the toolbar. Since #1631 the venue-type chips live in the `Filters` panel, so the spec opens Filters and finds the chip inside it.
  - `:240` (the disjoint pan), still red under load: it passed in each single run of the file, before and after the fix, and failed 2 of 2 in a 2x repeat at 2 workers. After three `Minus` presses below the layer floor, 1644 base-pub rows remained where the spec wants 0. The test does not use Escape, so the fix did not cause it. Next step: check whether the zoom keys reach the canvas, and whether the base stream clears below the floor on a loaded runner.
  - Proof on the rebuilt rig: the spec file gave 8 passed. A 2x repeat with `map-surface-history` and `surface-back-and-home` gave 44 passed and 2 failed, and both failures are `:240`.
- [x] R15 `price-caption-integrity.spec.ts` (4 fixed): `:336` (now `:338`) at 390 and 430, `:404` (now `:410`) at 390 and 430. One product bug and two stale spec steps.
  - `:338` wanted the date chip on The Grapes to read `1583`. Since #1506 a date chip names what the year dates, never a bare year (`lib/heritageDate.mjs`), and the record carries `dateLabel: "Founded 1583"`. The spec now expects that label on `/historic` and on `/borough/tower-hamlets`.
  - Product bug (`:410`): on every phone map the Near me FAB covered the compact OpenStreetMap credit. Both parked on the right edge of the band above the plan action (`--map-corner-bottom` and the credit's `+ 68px`), so the licence credit took no tap. With a Place story chip the chip covered the credit too, and Near me and the create action covered the chip's `Dismiss Place story intro` button. Fixed: the credit takes the left edge of the same band, and steps down into the plan action's berth while a story chip stands the plan action down (`components/mobile/mobileMapShell.css`). The phone story chip stops short of `--mobile-map-corner-lane` (`app/globals.css`), as that lane's rule asks of any full-width overlay. Pin: `price-caption-integrity.spec.ts:410` "mobile map renders story qualifier and attribution" at 390 and 430. It probes the centres of `Toggle attribution` and `Dismiss Place story intro`, and each hit must land on its own control, never on Near me (`.mobileMapLocateFab`).
  - `:410` then wanted the chip unmounted once List view opens. The list hides it with `display: none` so the story notice returns when the list closes (`components/map/mapVenueList.css`, #684). The spec now checks that the chip is hidden.
  - Proof on the rebuilt rig: the spec file gave 66 passed on a 2x repeat. The only failures are `:507` (R6, parked). `drink-chip-controls`, `mobile-map-chrome-fit` and `map-story` gave 46 passed. The 2 failures are the known separate reds `drink-chip-controls.spec.ts:188` and `map-story.spec.ts:120`.
  - Lead, not fixed: `.mappedRouteChip` and `.activeRoundChip` share the story chip's full-width phone berth and do not stop short of the corner lane either.
- [x] R16 Social and Activity heads (9 fixed): `social-shell.spec.ts:132`, `:449`, `:552`, `crews-and-people.spec.ts:11`, `:36`, `:55`, `mobile-activity.spec.ts:56`, `:82`, `:91`. The specs lied about the shipped product. Four causes.
  - `/social` opens on the Screen primitive (#1402): the kicker is `Social` and the one h1 is `Crews and people who are already here.`. `crews-and-people.spec.ts:11` and `:55` waited for an h1 named `Social`. They now wait for that h1.
  - Social is live by default (`lib/socialLaunch.ts`), so the surface is named `Social`, not `Social preview`. The invite-only boundary and the feed error are `EmptyState` titles, and `EmptyState` (#1365) prints its title as a line, not a heading. `social-shell.spec.ts:132` and `:552` now read `Social is invite-only for now. It opens more widely soon.` as text. `:449` reads `Social posts are unavailable right now.` in the posts region's alert. It taps that region's `Retry`, because the rail's Outbox has its own `Retry` (strict mode).
  - Minting an invite link is account-bound (#1348). A signed-out reader meets the `Sign in to invite` link (see R9), so `crews-and-people.spec.ts:36` found no `Get invite link` button. The test moved to its own `Invite link` describe with a seeded session and a handle, and retries the tap for hydration. The fallback copy and the `[object Object]` check are unchanged.
  - `/activity` is account-bound too (#1348). The spec seeded only the device handle `pubmax_handle`, so the page said `This corner is yours. Claim it.`. The spec now seeds the provider-shaped session and the canonical handle, as the Social specs do. The empty state's title is a line, and its one way onward is `Open Social` to `/social` (#765), not `Browse the feed` to `/feed`.
  - Proof on the rig: the three spec files gave 48 passed on a 2x repeat. The only failures were `crews-and-people.spec.ts:63` (`/api/profiles/directory` answered `429`). That route shares the per-IP `isLimited` budget of 8 per 60 s (`app/api/profiles/directory/route.ts`), and every verified or preview Social page in the repeat read the directory. Pace reruns 65 s apart.
- [x] R17 `mobile-map-first-visit.spec.ts:10` (3 fixed): 320, 390 and 430. The spec lied about the shipped product.
  - The spec wanted the cold phone map locked behind the First visit card: the chip row, the utility corner and the plan action hidden, and `inert` on `.mobileMapChrome` and `.mapCanvasWrap`. #1631 deleted the `inert` lock and moved the ask to a top strip under the phone's one bar (`components/AGENTS.md`, "THE ARRIVAL ASK IS A STRIP"). The chrome stays live beside the strip, and the ambient banners wait for the answer (`components/map/mapBannerStaging.css`).
  - The spec (now `:45`) checks the shipped rules: the strip sits under the chip row and above half the screen height, every ambient banner is hidden, the chrome and the canvas are not inert, and a hit probe finds each top bar, chip row, utility corner, plan action and strip button at its own centre. The camera controls stay hidden, and Close still releases the strip.
  - No product bug: a hit probe at 320, 390 and 430 found every control under the strip tappable, and the screenshots show no overlap.
  - Proof on the rig: the spec file gave 6 passed on a 2x repeat at 2 workers.
- [x] R18 `mobile-map-list-obstruction.spec.ts:128` (2 fixed): 390 and 430. The spec lied about the shipped product.
  - The spec opens the venue list from Map controls, then waited 120 s for `Close venue list`. A list opened from Map controls has a Back action, so its close names the map it returns to: `Close and return to the London map` (`homeActionLabel`, `components/map/MapVenueList.tsx`). `Close venue list` shows only when the list has no Back. `mobile-map-shell-matrix.spec.ts` already uses the new name (R2).
  - The spec now taps that close, checks that the list is gone, and keeps its checks that `Describe the outing` comes back and opens the planner sheet.
  - Proof on the rig: the spec file gave 8 passed on a 2x repeat at 2 workers.
- [x] R19 the phone map top bar after #1631 (2 fixed): `mobile-map-controls.spec.ts:30`, `mobile-map-search.spec.ts:14`. One product bug and five stale spec steps.
  - `:30` read the place name from `.mobileMapCity`. The top bar prints it in the city switcher `Map area: London. Change city`, as `.citySwitcherLabelFull`.
  - Both specs looked for a `searchbox`. The map search field suggests pubs, so it is a `combobox` named `Search pubs` (see R1).
  - `:30` opened a `Drinks` button, chose a category in a select and waited for a `Gin brand` picker. #1631 put the drink filters in the top bar's `Filters` sheet as drink shape chips, and moved the brand slot into the drink lane's panel. The spec now taps `Wine`, then `Gin`. It checks that Gin replaces Wine, that the URL carries `drink=gin`, and that the drink lane chip names Gin. The Map controls sheet opens on its Key tab, so the spec opens the Layers tab. The closes are `Close Prices and places` and `Close Map controls`.
  - The tap-target check read one box. The Layers panel scales in as it opens, and a chip read during that entry measured 43px against its 44px rest size. The check now reads the box after it stops moving, as `mobile-map-shell-matrix.spec.ts` does.
  - `mobile-map-search.spec.ts:14` searched for `Arnos Arms` with `?food=1` still set. The slim pack records no food at Arnos Arms, so `requireFood` hides it and the map shows 0 venues. The spec now searches for `German Gymnasium`, which serves food. No other row's search text carries that name.
  - Product bug: a top bar control that closed its own open overlay (`Search the map`, `Filters`, `More map controls`, the drink and Tonight chips) set the overlay to `none` and left that surface on the map trail. The trail hook asks every deliberate exit to call `back()` or `home()` (`components/map/pubmap/useMapSurfaceNavigation.ts`). So after the reader closed search, the Filters sheet offered `Back to Search`, and the first browser Back changed nothing on screen. The new `:30` close step caught it. Fixed: the toggle steps back down the trail, as Escape does (`components/mobile/MobileMapShell.tsx`, the full and the limited-coverage bar). Pin: `__tests__/mapShellSheetOwnership.test.ts` "an open overlay's own control closes it down the trail", red on the old toggle.
  - Proof on the rebuilt rig: both spec files gave 6 passed on a 2x repeat. `surface-back-and-home`, `map-surface-history`, `mobile-map-chrome-fit`, `mobile-map-shell-matrix`, `mobile-bottom-nav`, `map-search-typing` and `mobile-map-list-obstruction` gave 67 passed.
  - Closed: the phone Layers tab (`MapLayersControl embedded` in `components/PubMap.tsx`) now carries `Reset view`. It runs the same compass ease as the desktop popover (`resetCameraAttitude` in `components/PubMapCanvas.tsx`, handed up through `onCameraResetChange`) and shows only while the camera is off the city's own attitude. Proof: `e2e/map-gestures.spec.ts` "a phone turns and tilts the map, and Reset view in the Layers tab gives back the view" on a 390px production build.
- [x] R20 `w3-getting-there.spec.ts` (2 fixed): `:16` (now `:30`) and `:105` (now `:119`). The spec lied about the shipped product.
  - The spec (16 Jul) read the `Getting there` region straight from the venue sheet's Overview. #684 (30 Jul) folded that region into the Overview's `Details and practical info` disclosure (`details.venueOverviewMore`, `components/map/inspector/VenueOverviewTab.tsx`), which is closed on arrival. `mobile-venue-sheet-tabs.spec.ts` already checks that it starts closed. So `Share location for travel times` was in the DOM but hidden, and both tests waited out their budget.
  - The spec now opens the disclosure first (a retried tap on its summary, the e2e/AGENTS.md idiom) and reads the region inside it. Every privacy, routes, Forget and Retry check is unchanged.
  - No product bug: the error snapshot shows the sheet on Prospect of Whitby with the disclosure closed, and the region answers once the disclosure opens.
  - Proof on the rig: the spec file gave 4 passed on a 2x repeat at 2 workers.
- [x] R21 `design-taste-wave-1.spec.ts:97` (2 fixed): light and dark (now `:99`). The spec lied about the shipped product.
  - The spec (#1399, 4 Sep) held the first `/today` pint figure (`.todayPintPrice`) to `--ink`. The next day the captain's price colour law (#1499, 5 Sep) made every price wear its band and no other colour, and it names `/today`: `TodayPintsCard` passes `priceBand(...)` to `PriceBadge`, and `__tests__/priceBandSurfaces.test.ts` pins that. So the figure painted the cheap band's ink (`color(srgb 0.09 0.43 0.30)` light), and the colour check failed before the eyebrow checks ran.
  - The spec now works out the band from the figure's own pounds and its pub (`priceBand`, `priceBandAreaForVenue` on the row link's `sel`), checks that the figure carries that band class and no other, and checks that its colour is that band's ink, read off a probe (the `e2e/price-colour-law.spec.ts` idiom). The eyebrow, `/tonight` music kind and `/pint-index` kicker checks are unchanged.
  - No product bug: the colour is the documented law (`docs/DESIGN_SYSTEM.md`, `CONTEXT.md` "Price band").
  - Proof on the rig: the spec file gave 12 passed on a 2x repeat at 2 workers.
- [x] R22 `exception-capture.spec.ts:68` (1 fixed, now `:75`). The spec lied about the shipped product. It is the R5 cause.
  - The spec opened `/` and waited 10 s for the `Anonymous analytics choice` card, so that it could tap `Allow` before it threw a crash. Since #1604 the card waits until the product has answered (`lib/consentAnswerMoment.ts`), and a cold `/` has not answered. So the card never painted.
  - The spec now seeds `pubmax:consent-answer-moment:v1` as `venue-sheet`, as `analytics-consent.spec.ts` does. The wait itself stays owned by `e2e/consent-after-first-answer.spec.ts`. Every check on the `$exception` event is unchanged.
  - No product bug: once consent is given, the crash reaches the capture endpoint as `TypeError` / `Redacted (/)`, with no user text.
  - Proof on the rig: red before the change (the card was not found), then 3 passed on a 3x repeat at 2 workers. The other specs that read the card, `night-mode-chrome.spec.ts` and `messages-thread.spec.ts`, gave 13 passed.
- [x] R23 `site-nav-more.spec.ts:3` (1 fixed). The spec lied about the shipped product.
  - The spec wanted the More menu's Plan item to read `Build a three-stop outing`. Since #1512 (5 Sep, "a Plan may be one pub") `SITE_NAV_MORE_LINKS` in `components/nav/SiteNavMore.tsx` reads `Build a night out`, and `__tests__/siteNav.test.ts` pins that copy.
  - The spec now expects `PlanBuild a night out`. The short viewport fit, focus, `End`, `Escape` and `ArrowUp` checks are unchanged.
  - No product bug: a three-stop promise is false for a one-pub Plan.
  - Proof on the rig: red before the change (`Build a night out` received), then green on a 3x repeat at 1 worker.
- [x] R24 `mobile-permalink.spec.ts:63` (1 fixed). The spec lied about the shipped product.
  - The spec wanted the unknown Pint Drop empty state to offer `Go to the feed` with href `/feed`. Since #765 (6 Aug, the unified social shell) `NotOnTheWall` in `app/p/[id]/page.tsx` ships `Browse pubs & pints` with href `/social?tab=discover`, and `/feed` only redirects to `/social`. The spec dates from 13 Jul.
  - The spec now expects `Browse pubs & pints` and `/social?tab=discover`, the same link `social-loop.spec.ts` already checks. The 200 status, heading, 44px tap target, overflow and page error checks are unchanged.
  - No product bug: the link lands on Discover directly, with no redirect hop.
  - Proof on the rig: red before the change (the link was not found), then 6 passed for the spec file on a 3x repeat at 1 worker.
- [x] R25 `mobile-rounds-index.spec.ts:30` (1 fixed). The spec lied about the shipped product.
  - The spec (11 Jul) wanted a `Join with a link` heading and a `Start a round on the map` link. Since #1402 (4 Sep, every launch route on the `Screen` primitive) `app/rounds/page.tsx` titles the page `Who bought the last round.`, paints `Join with a link` through `EmptyState`, whose title is a paragraph (`components/ui/empty-state.tsx`), and gives the `Screen` one primary link, `Start a round` (href `/map`).
  - The spec also waited for a `searchbox` named `Search pubs` on the map. The map search field suggests pubs, so it is a `combobox` (see R1 and R19).
  - The spec now reads `.emptyStateTitle` with `Join with a link`, the exact link `Start a round`, and the `Search pubs` combobox. The 200 status, body line, href, 44px tap target, overflow, top bar, Near me, `Describe the outing` and `Search the map` checks are unchanged.
  - No product bug: the Screen owns the page's one heading, and the link lands on `/map`.
  - Proof on the rig: red before the change (the heading was not found), then 3 passed on a 3x repeat at 1 worker.
- [x] R26 `mobile-round-lifecycle.spec.ts:9` (1 fixed). The spec lied about the shipped product.
  - The spec seeded the shared `pubmax_handle` for the mate and for the host. Since #673 (29 Jul) the Round page reads its own anonymous identity, `pubmax_round_anonymous_identity_v1` = `{ owner: "anonymous", handle }` (`readRoundAnonymousHandle` in `lib/roundRequest.ts`). So the join field was empty, the Join tap showed `Pick a handle to join.`, and `2 out · still going` never came. The host page could not see `Call the Round (close it)` either, because `isCreator` needs that handle.
  - Both init scripts now seed the new key in the shape `writeRoundAnonymousHandle` writes. The Join tap, copy code, add a pub, spend, overflow and the two-tap close are unchanged.
  - No product bug: `components/round/RoundStarter.tsx` writes the key for the device that starts a Round, and the join form writes it for a mate.
  - Proof on the rig: red before the change (`2 out · still going` not found), then 3 passed on a 3x repeat at 1 worker.
- [x] R27 `quality-floor.spec.ts:155` (1 fixed). The spec lied about the shipped product.
  - The spec (6 Jul, moved to a 390px phone in #121) opened the phone planner sheet and wanted the `Non-alcoholic` checkbox in its `.controlRail`. Since #700 (3 Aug, "One planner per surface") `components/PubMap.tsx` mounts `ControlRail` only when `!mobileViewport`. The rail is the desktop planner, and the phone planner sheet carries the `Describe the outing` form instead.
  - The spec now runs at 1280x900, opens the desktop planner with `Plan an outing` (the idiom of `social-loop.spec.ts`), and finds the checkbox in `.controlRail`. The count, visible, unchecked, check and uncheck assertions are unchanged.
  - No product bug: `ControlRail` still ships the `Non-alcoholic` checkbox, and `requireNonAlcoholic` still filters the map. The phone planner's `Alcohol-free` chip is a route need, not this map filter.
  - Proof on the rig: red before the change (0 checkboxes in the planner sheet), then 30 passed for the spec file on a 3x repeat at 1 worker.
- [x] R28 `venue-acceptance.spec.ts:68` (1 fixed). The spec lied about the shipped product.
  - The spec (#1057) wanted 3 or more buttons in the phone `Venue actions` toolbar, when the bar held `Make it Stop 1`, `Add price` and `Share`. Since #1517 (5 Sep, "one price door per trust state") the bar carries no price action: the Overview's price door is the one painted price action (`overviewPriceDoor`, `lib/pintTrust.ts`). A suggest-mode pub sheet holds `Make Arnos Arms Stop 1` and `Share Arnos Arms`, and `Crawl` shows only in build mode (`components/map/inspector/VenueStickyBar.tsx`).
  - The spec now names both shipped buttons and expects exactly 2. The 44px height and overflow checks at 320px and 390px are unchanged.
  - No product bug: both buttons are 44px or taller, and the page has no horizontal overflow.
  - Proof on the rig: red before the change (2 buttons received), then 12 passed for the spec file on a 3x repeat at 2 workers.
- [x] R29 `near-venue-acceptance.spec.ts:27` (1 fixed). The spec lied about the shipped product.
  - The spec (#1057) wanted `Keep for tonight` (`.nmnAccept`) at least 48px tall. Since #1508 (5 Sep, "one text-button family, read from the control tokens") `components/nearme/nearMeNow.css` paints it from the `--control-*` row: `min-height: var(--control-height)` (44px), and `--control-tint-surface` and `--control-tint-border` for the background and border (`docs/DESIGN_SYSTEM.md`, "Text buttons").
  - The spec now reads `--control-height` off its probe, holds that token to the 44px floor, and holds the button to at least that height. The colour check is unchanged: the tint tokens alias `--state-active-surface` and `--state-active-border` (`app/globals.css`), so the probe still matches. The name fit, overflow, receipt, browse, accept and storage checks are unchanged.
  - No product bug: 44px is the tap floor, and the button family is one geometry by design.
  - Proof on the rebuilt rig: red before the change (44 received, 48 or more wanted), then 9 passed for the spec file on a 3x repeat at 1 worker.
- [x] R30 `mobile-discover-coverage.spec.ts:11` (1 fixed). The spec lied about the shipped product.
  - The spec (#376) wanted the h2 `Areas near you, with the gate visible` and the line `Only an area with a complete, live gate can produce a Crawl Route`. Since #511 (22 Jul, "Kill AI-sounding copy", `docs/VOICE.md` rule 2) `components/night/NightAreaCoverage.tsx` ships the h2 `Where you can plan a crawl tonight` and the intro `We only call an area crawl-ready when its prices are fresh and checked. The rest are yours to browse.` No product file still holds the old strings.
  - The spec now pins the shipped heading and the first sentence of the intro. The `Open planner` link, the 44px planner action, the `details` open, the five coverage states, the map link and the overflow checks are unchanged.
  - No product bug: the intro keeps the same promise, that only a fresh, checked area can become a crawl.
  - Proof on the rig: red before the change (heading not found), then 3 passed on a 3x repeat at 1 worker.
- [x] R31 `near-desk-mode.spec.ts:59` (1 fixed). A product bug the spec caught.
  - #1553 (5 Sep) made `/near` `force-static`, so the build writes one no-query document, which shows the Pint surface. `NearPageBody` in `components/nearme/NearPageClient.tsx` (#1063) still read `?mode=desk` before hydration and rendered Desk. React found Desk text where the document held Pint text and threw `Minified React error #418` (args `text`). `/near?src=poster` threw the same error (args `HTML`), because `PosterLandingNote` got `src` before hydration and added a line the document did not hold.
  - The fix: one `hydrated` flag (a `useSyncExternalStore` whose server snapshot is false) gates every value the body renders from the query. The new pure `resolveNearPageMode` answers Pint until hydration ends, then lets the query lead the remembered mode. `PosterLandingNote` gets `src` only after hydration. The spec is unchanged. `__tests__/nearPageClient.test.ts` pins the resolver.
  - Proof on the rebuilt rig: red before the change (1 `#418` page error), then 9 passed for the spec file on a 3x repeat at 1 worker. A probe of `/near?mode=desk&patch=soho`, `/near?src=poster`, `/near?src=poster&mode=desk&patch=soho`, `/near?patch=soho` and `/near` saw no page error.
- [x] R32 `ui-consistency-layout.spec.ts:901` (1 fixed). Two product bugs the spec caught, one after the other. The spec is unchanged.
  - `Edit profile` sent the whole profile page to the `Spilled.` error boundary: `TypeError: Cannot read properties of undefined (reading 'manual_link')`. `SocialLinksEditor` stored the `providers` object from `/api/social-connections` as the full provider record, then read `providers[option].manual_link` for all ten `SOCIAL_PROVIDERS`. The spec answers three providers in an older shape, so `youtube` was undefined. An answer from a server that knows fewer providers (a deploy skew) does the same. Fixed: `readProviderCapabilities` (`lib/socialProviderCapabilities.ts`) gives every known provider a row, and only a literal `true` grants a capability. The editor reads the answer through it. Pin: `__tests__/socialProviderCapabilities.test.ts`.
  - `Analytics choices` then did nothing. #689 added the item when the account hub was a static import. #1421 made `PubmaxxAccountHub` a `dynamic` import with `ssr: false`, so a tap before that chunk lands finds no `#analytics-settings`, and the old `onSelect` returned without a word. Fixed: the tap moves the hash at once, and `revealWhenMounted` (`lib/revealWhenMounted.ts`) scrolls to the block when it mounts, with a 10 s wait. Pins: `__tests__/revealWhenMounted.test.ts`, and `ui-consistency-layout.spec.ts`, which checks that `Analytics choices` brings `#analytics-settings` into view.
  - Proof on the rebuilt rig: red before each change (the error boundary, then the unchanged URL), then 3 passed on a 3x repeat at 1 worker. `profile-avatar.spec.ts` and `profile-photo-crop.spec.ts` gave 11 passed. Their 2 failures were red before this change (see below).
- [x] R33 `profile-photo-crop.spec.ts:448` (1 fixed, now `:451`). The spec lied about the shipped product, in two steps.
  - The spec answered the fresh image with `page.route("**/api/avatar/<id>/<generation>")`. Since #1035 (12 Aug) `next.config.mjs` sets `deploymentId`, and a production build tags the image `src` with it (`?dpl=local` on the rig). A glob that ends at the path does not match that URL, so the request reached the keyless server, which answered 404. `HandleAvatar` then fell back to initials, and `header.profileHeader img.profileAvatar` was never found. The spec's own `src` regex already allowed the query. Both image routes (`captureUpload` and the cover remove test) now end in `**`, as `profile-avatar.spec.ts` does.
  - The next step then failed: the spec read `record.calls` right after the second `Use photo` tap. The heading it waited on never left the screen, so that wait proved nothing about the POST. The spec now polls the route's count for 2.
  - No product bug: the second photo goes up from the open editor, and the card's face paints the fresh image.
  - Proof on the rig: red before the change (the header image not found), then the spec file gave 24 passed on a 3x repeat at 2 workers.
- [x] R34 `mobile-moment-flow.spec.ts:12` (1 fixed). The spec lied about the shipped product.
  - The spec wanted the capture label `Take a photo`. Since #1547 ("the picker is a picker") the Moment picker's label is `Add a photo` on a phone and `Upload a photo` on a desktop (`pickerPrimary`, `components/moment/MomentCapture.tsx`), because the input opens the photo library as well as the camera.
  - The spec now reads `Add a photo` at 390px. The heading, Pint Drop link, above-the-tab-bar, draft and refresh checks are unchanged.
  - No product bug: a label that says "take" is false for a library photo.
  - Proof on the rig: red before the change (`Take a photo` not found), then 3 passed on a 3x repeat at 2 workers.
- [x] R35 `profile-avatar.spec.ts` `:178` and `:247` (now `:252`) (2 fixed). The specs raced the shipped product.
  - Both specs waited for `expect.poll(() => profileRequests).toBe(1)`. The page reads `/api/profiles/<handle>` twice on load. The profile effect in `app/u/[handle]/ProfilePageClient.tsx` is keyed on `accountRevision`. `AuthProvider` publishes `readProviderIdentityRevision` under that name, and that revision also moves on `setProviderAuthState`. A keyless provider moves it once when it settles, so the effect aborts the first read and starts a second one about 30 ms later. The poll saw 1 only when it ran inside that gap.
  - `:247` had a second race. It dispatched `online` once, straight after the profile count. When that event came before the 503 made `HandleAvatar` mark the image failed, no retry listener was attached yet, and the initials stayed. A trace showed the page reading the profile twice and the avatar once, with no `online` retry.
  - `:178` now waits for at least one held profile read. `:252` waits for the first (failed) avatar request and the fallback, then repeats the `online` event inside `toPass` until the image `src` returns, as e2e/AGENTS.md retries a dropped tap. The `naturalWidth > 0` check and the "at least 2 avatar requests" check are unchanged.
  - No product bug for these specs: a reconnect retries the image after a failure. Lead, not a red: the context field is documented as an "opaque account boundary", but it also advances on auth-state changes, so every surface keyed on it reads again once on first load. A fix belongs in `components/auth/AuthProvider.tsx` and changes the auth seam, so it is not in this group.
  - Proof on the rig: `:247` failed 2 of 3 before the change. After it, `:178` and `:252` each gave 5 passed on a 5x repeat at 1 worker, and the full file gave 6 passed at 2 workers.
- [x] R36 `dark-primary-surfaces.spec.ts:229` (now `:223`) at 390 and 430 (2 fixed). The spec lied about the shipped product, in two steps. Both come from #700 (3 Aug, "Selection is the fill", `components/map/venueSheet.css`).
  - The spec (#684, 30 Jul) measured the active venue tab as a gradient. #700 replaced the coral gradient with a flat `--panel-raised` fill, ink text and a 2px coral underline. The gradient read found 0 colour stops, so the check failed on `expected 0 to be greater than 0`. The spec now checks that the active tab has no `background-image` and measures its text over the flat fill. The gradient path had no other caller, so it is gone.
  - The focus outline check then read 2.58, where 3 or more is wanted. #700 also made the tab rail `transparent`, so the rail's backdrop is the dark sheet, which is 82% `--panel-overlay` (`--sheet-material`, `app/theme.css`). `resolveBackdrop` composited that sheet over white, so 18% white showed through and the rail read as about rgb(80, 80, 85). A screenshot probe on the rig paints the rail at rgb(39, 38, 42) and the tab fill at rgb(32, 32, 36), and coral `#ff5a5f` on either is about 4.9 to 1. `resolveBackdrop` now composites over the page floor, the first stop of the body's painted gradient (rgb(10, 10, 11) in dark). The 3 to 1 floor is unchanged.
  - No product bug: the focused tab's coral outline is 2px, drawn inside the tab, and clears 3 to 1 against both colours next to it.
  - Proof on the rig: red before the change (0 gradient stops, then 2.58), then the spec file gave 12 passed on a 3x repeat at 2 workers. No product code changed.
- [x] R37 `map-search-no-results.spec.ts:160` mobile dark normal and mobile dark reduced (2 fixed). The spec raced hydration.
  - `openMapSearch` read `getByRole("button", { name: "Search the map" }).count()` and tapped once. The phone top bar paints that toggle from server HTML, so the tap could land before React attached and open nothing, or the count could read 0 before the bar painted and skip the tap. The field then never showed in 20 s. The error snapshot shows the toggle on screen and not expanded. This is the "lone click" case in `e2e/AGENTS.md`.
  - On this branch a different phone case failed each run (mobile light reduced on the first run), which fits a race and not one theme.
  - The helper now retries the tap inside `toPass` until the search field is visible, and it taps only when the field is not yet visible, because the toggle closes an open search. The desktop path and every check after the field opens are unchanged. `:62` (mobile miss) uses the same helper.
  - No product bug: the toggle opens the search field once React has attached.
  - Proof on the rig: red before the change (1 of 10 failed, the field not found), then the spec file gave 30 passed on a 3x repeat at 2 workers.
- [x] R38 `a11y-core-journeys.spec.ts:115` "discover: tonight" at 390 and 1440 light (2 fixed). A product bug the spec caught. The spec is unchanged.
  - #1627 painted each hyped row's credit link (`.tonightHypedSource`) and its `Open on map` link (`.tonightHypedMap`, `.tonightChainRowMap`) with raw `var(--brass)` at small text. In light, that is 2.5 to 1 up to 2.9 to 1, so axe found `serious:color-contrast` on 9 nodes. Dark passed. This breaks the "coral is a fill and coral is a word" rule in `components/AGENTS.md`.
  - Fixed: the three selectors use `var(--color-accent-ink)` (`app/tonight/tonightLede.css`). Dark keeps the same coral through `app/theme.css`. Pin: the axe run in `a11y-core-journeys.spec.ts:115`, red on the old CSS.
  - Proof on the rebuilt rig (build at `c1da6b1fa`): the test gave 2 passed on a 2x repeat at 2 workers.
- [x] R39 `map-story.spec.ts:120` (1 fixed). The spec lied about the shipped product.
  - The spec found The Dove's Asahi row with `.drinkRow` and `hasText: /Asahi/i`. Since #1339 (3 Sep, "show public Pint Drops in venue menus", `lib/pintDropDrinks.ts`) each public Pint Drop joins the Drinks menu as its own row. The keyless store seeds two demo Asahi drops at The Dove (£7.00 and £7.20, badged `Demo`), so the locator matched 3 rows and hit strict mode.
  - The spec now takes the Asahi row that carries the `Pint Prices` link. The £7.25, publisher href and footnote checks are unchanged.
  - No product bug: each demo row carries its `Demo` badge, and the publisher row keeps its source link.
  - Proof on the rig: red before the change (strict mode, 3 rows), then green in the R40 run below.
- [x] R40 `drink-chip-controls.spec.ts:188` (1 fixed). The spec lied about the shipped product, in three steps.
  - The spec matched the pressed price row's text with `/^Zone 5(?![0-9])/`. A thin zone's row reads `Zone 5`, `2/10`, `log more`, so the text is `Zone 52/10log more`, and the lookahead rejects it. The pattern passed only while zone 5 had 10 or more priced pubs. The spec now reads the cell's own `.zonePintCellZone` text.
  - The spec then compared the resting border colour of the Zone 5 price row and the Zone 5 chip (#683). Since #700 (3 Aug) the map picker's zones are one segmented control with hairlines, the price rows are borderless, and selection is the fill (`components/map/zonePicker.css`, `components/zones/zonePintIndex.css`). A 0px edge reports `currentColor`, so the read compared ink colours (`rgb(63, 63, 70)` against the chip's hairline set). The spec now checks that the two controls paint the same fill when Zone 5 is selected and again at rest, and that the fill changes on reset.
  - A selected chip is named `Zone 5 (selected)`, so the chip locator matches both names.
  - No product bug: the chip and the price row paint the same fill in both states.
  - Proof on the rig: red before the change (the regex, then the border read), then `map-story.spec.ts` and `drink-chip-controls.spec.ts` gave 69 passed on a 3x repeat at 2 workers.
- [x] R41 surfaces that launch rebuilds removed or renamed (4 fixed): `founding-members.spec.ts:176`, `wanted-wave-a.spec.ts:42`, `map-performance.spec.ts:43`, `a11y-keyboard-loop.spec.ts:314` (`/`). The specs lied about the shipped product. Four causes, one per spec.
  - `founding-members.spec.ts:176` wanted no `Founding member` text for an ordinary account. Since #1302 (1 Sep) You and Social carry `FoundersWallLink` ("Founding members", to `/founders`) for every reader. It reads nothing about the viewer, which `lib/foundingMembers.ts` asks for, so it is not a founding surface. The spec now counts founding text outside that link, checks that no `.accountHubFounding` card shows, and checks that each wall link is the plain label to `/founders` with no count. The Discord checks are unchanged.
  - `wanted-wave-a.spec.ts:42` waited for a `What's the plan` heading on `/plan`. Since #1402 the Screen primitive owns the one h1, `Describe the outing. We’ll put it in order.` (`components/plan/PlanDescribeFirst.tsx`). The Wanted lane and `/api/wanted` checks are unchanged.
  - `map-performance.spec.ts:43` tapped the landing's `Beer at … open on the map` link under `#signals`. #912 (8 Aug) removed the Night Signals section, and no shipped door writes `drink=beer&style=cheapest` now. The spec opens that map URL directly. It then opened a `Drinks` button and read a `Drink category` select, which #1631 removed. The spec now checks `Filters: drinks active`, the drink lane chip `Pints` (`DEFAULT_DRINK_LANE_LABEL`, `lib/drinkLanes.ts`), and `Beer (selected)` in the Filters sheet. The first-pins, loading and no-journey checks are unchanged.
  - `a11y-keyboard-loop.spec.ts:314` found 7 SVG `g` elements "parked" on `/`. #1628 (7 Sep) draws London as a `role="img"` SVG, and each pin group sits at `transform="translate(x y)"` in the drawing's own units. That is placement, not a parked transition. The probe now skips an SVG element that carries a `transform` attribute. CSS transforms, the opacity check and `/tonight` and `/plan` are unchanged.
  - No product bug: each spec now reads the shipped surface, and every behaviour check it held still runs.
  - Proof on the rig: red before the change, then `founding-members` and `wanted-wave-a` gave 21 passed, `map-performance` gave 9 passed, and the reduced-motion tests gave 9 passed, each on a 3x repeat at 2 workers. `map-near-me.spec.ts:115` passed on this branch with no change.
- [x] R42 `landmark-story-sheet.spec.ts` (2 fixed): `:277` (now `:288`, G1) and `:323` (now `:335`, G3). The spec lied about the shipped product. Two causes.
  - `:288` read the pub's name off a settled list, then tapped the row with that name. The settle is two equal reads 400 ms apart, and the opening venue shards hold the list still for about 1 s: `Lamb and Flag|White Swan|Mercers Arms`. Then the nearer pubs land and the list re-ranks to `The White Lion|The Old Bell|Nell Gwynne Tavern`. The spec kept the stale name, and `click()` with no budget waited for a row that was gone until `toPass` ended at 45 s. A run log showed `settled Lamb and Flag|… opened The White Lion`, and a probe of the same journey opened the pub, went Back to the story and opened it again.
  - `openStoryPub` now reads the first row's name on each attempt, taps that name with a 4 s budget, and gives the name back. The venue sheet title must equal that name on both opens. The `Back to Covent Garden` trail, the `sel` and `landmark` URL checks, the browser Back and the page error checks are unchanged.
  - `:335` read `.mapCameraControls` beside the story drawer. Since #1631 the map edge keeps only a route's `Recenter` (`canRecenter`, `components/PubMapCanvas.tsx`), and Show all and the compass live in the Layers popover. So the locator waited out the 90 s test budget. The spec now checks that the Layers entry and the open popover's Show all and compass sit right of the drawer and own their centres. The retried tap opens Layers, as `e2e/AGENTS.md` asks.
  - No product bug: the story's Back trail works, and no desktop map control sits under the drawer.
  - Proof on the rig (build at `6ff315178`): red before each change (`:288` 2 of 2, `:335` 4 of 4), then the spec file gave 18 passed on a 3x repeat at 2 workers. eslint is clean.
- [x] R43 `map-tile-retry.spec.ts` `:43` desktop and `:95` (2 fixed, now `:50` and `:102`). One spec gap under the `chromium` project, then two product bugs the spec caught.
  - The spec says it runs under `chromium-gl`, and `playwright.config.ts` lists it there. The `chromium` project does not list it in `testIgnore`, so `--project=chromium` runs it too. `chromium-gl` sets `serviceWorkers: "block"`. `chromium` does not.
  - The production build registers `public/sw.js`, and its tile cache fetches basemap tiles inside the worker. `page.route()` does not see those fetches. About 4 s after load, the worker owned the tile requests. Each one went to the real tile host and failed with `net::ERR_FAILED`, after the fixture's 6 planned aborts were spent. A trace shows `__empty/13/4094/2723.png` answer 200 once, then fail again and again.
  - So on `:43` desktop, the "transient" outage never ended. The silent lane spent its two source reloads, and the style reload printed `tile failure burst, reloading style`. On `:95`, the endless failures kept the map inside the silent lane past the 60 s wait.
  - The spec now sets `test.use({ serviceWorkers: "block" })`, as `profile-avatar.spec.ts` and `occupancy.spec.ts` do, with a comment on why. Every check is unchanged.
  - With the worker blocked, `:50` passed 3 of 3, and `:102` still failed 3 of 3 on `the style reload is kept for a real outage` (2 of 2 under `chromium-gl` too). That was the product.
  - Product bug 1: a dead tile host could leave the map in no lane at all. On a cold load, all 76 tile requests failed in 1.3 s, inside the 1 s arrival turn (`MAP_ARRIVAL_BEARING_DURATION_MS`). `classifyTileFailure` ignores a sample while the camera is in flight and waits for the next error. MapLibre never asks for a failed tile again, so no next error came: no silent reload, no style reload, and no `[pubmap]` line for 44 s. Fixed: an ignored in-flight sample on a visible tab arms one `moveend` re-read of the same stamps (`tileFailureAwaitsCameraRest` in `lib/mapTileFailure.ts`, called from `evaluateTileFailure` in `components/PubMapCanvas.tsx`).
  - Product bug 2: the re-read then found no stamps. `markBasemapRecovered` runs on every `render` and `idle`, and it took "tiles loaded, no failed tile recorded" as a real paint. MapLibre counts an errored tile as settled, and no failed tile is recorded while the first basemap is pending or the camera moves. So a frame over a dead host wiped the stamps, ended the initial wait and handed back the silent budget, with no tile painted. A probe also saw it clear `surfaced` after the banner showed, so the silent lane started again. Fixed: a recovery needs a tile that really loaded in this style generation (`basemapRecoveryConfirmed` in `lib/mapTileFailure.ts`, over `basemapTileReadyForPaint`).
  - Pins: `__tests__/mapTileFailure.test.ts` "a tile burst that lands inside a camera flight" (the two helpers and the canvas `moveend` arm). Both helpers are new, so the pins are red on the old code.
  - Proof on the rig: red before the changes under `chromium` (`:43` desktop and `:95`, 2 of 2 runs; then `:102` 3 of 3 and 2 of 3 with the worker blocked). After them, the spec file gave 12 passed on a 3x repeat at 2 workers, and `:50` plus `:102` gave 15 passed on a 5x repeat at 2 workers. A final rebuild gave 8 passed on a 2x repeat. `map-arrival`, `map-blocked-fallback`, `map-arrival-card-pins`, `map-desktop-arrival-chrome`, `mobile-map-first-visit` and `smoke` stayed green (34 passed). The one failure in that batch was `map-webgl-recovery.spec.ts:18`, which is red on HEAD too (see "not yet grouped").

- [x] R44 the three map journeys the dependency run found red (3 fixed): `map-gl.spec.ts:151`, `map-console-health.spec.ts:78`, `map-deep-link-pin.spec.ts:98`. They fail the same on maplibre-gl 6.7.0 and 6.9.0, so the dependency bump is not the cause. Two product bugs, one stale spec read, and the `chromium` project gap behind all three.
  - Product bug 1 (`map-gl.spec.ts:151`, the three-stop invite handoff): a shared plan can name stops outside the opening viewport, and the slim shard loader reads only the map the reader is looking at, so `venueById` never carried those ids and RoutePanel drew an empty planner. Fixed: the built stops missing from the settled pack are warmed through the same detail seam a selected venue uses (`warmVenueDetail`) and merged into `venueById`. A stop is asked for once per mounted map whatever the answer, and the plan is left exactly as the link wrote it: this lane warms stop detail and never edits, dedupes or reorders the reader's stops. Pins: `__tests__/pubMap.test.ts` "builtStopsNeedingHydration", which holds the request set to the stops a settled pack does not carry, bounded by `WALK_ROUTE_MAX_STOPS`, and "builtStopsAskedAfter", which holds a failed or missing answer to leave its stop asked.
  - Product bug 2 (`map-deep-link-pin.spec.ts:98`): a cold `?sel=` arrival paints the canvas before the phone sheet portal mounts, so the selection camera measured no sheet, took the fraction fallback and parked the named pin above the visible band. Fixed: the cold deep-link arrival waits for the sheet's own edge to settle and then makes one move, with no correction move (`whenBottomSheetSettles`, `components/map/canvas/useMapCamera.ts`). An ordinary tap on a painted map still moves at once. The settle watcher's `grown()` also measured cover against the window rather than the map container, which is corrected with it.
  - Stale spec read (`map-console-health.spec.ts:78`): the spec waited for `.mapCompassBtn` on the map edge. Since #1631 the one compass lives in the desktop Layers popover, so the spec opens that popover and reads the compass inside it, and still holds the global "one compass" count and MapLibre's own compass at 0. `map-gestures.spec.ts`'s compass test moved into its own `test.describe` at a touch tablet's 820x1180, because the popover that owns the compass is hidden at a phone width. The phone block of `map-console-health` states the phone contract as it ships: no native compass, `More map controls`, native zoom hidden, and no phone compass at all (R19's lead stays open).
  - The `chromium` project gap (see R43): `map-console-health`, `map-arrival-turn`, `map-arrival-card-pins`, `map-desktop-arrival-chrome`, `map-tile-retry`, `map-webgl-recovery` and `ui-ux-battle-test-keyless` are matched by a dedicated project but were not in `chromium`'s `testIgnore`, so `--project=chromium` ran each of them a second time without its own launch flags, base URL or blocked service worker. All seven are now ignored there, and the class is fenced rather than hand-listed: `__tests__/playwrightProjects.test.ts` reads the real config and holds every `testMatch` entry of the dedicated Chromium projects to appear in `chromium`'s `testIgnore`.
  - The local rig also lost its server mid-suite and answered `connection refused` to later contexts. `playwright.config.ts` now caps a local run at 2 workers, which is what the shared in-memory per-IP lanes carry; CI shards keep their own server each and stay uncapped.
  - Proof: pipeline test step.


## Reproduced on this branch, not yet grouped

A triage run at `6cce61609` (14 Sep 2026, keyless rig, 2 workers) of appendix specs that no group has touched. Each line is the first failing assertion.

- `map-webgl-recovery.spec.ts:18` (appendix G3): after the synthetic `webglcontextlost`, the canvas or the whole `.maplibreMap` is gone. The run then fails at `:65` (canvas not found), `:66` (`.mapFallback` count) or `:74` (a 60 s timeout on `data-webgl-recovery`). With a trace on, the run passes in 2 s. A/B on the rig at 1 worker, 3x repeat: the HEAD product at `b32ce73f8` failed 3 of 3, and the build with R43's fix failed 2 of 3. So it is not R43's cause. The real tile host answers 200 from this machine. Next step: trace the `reinit` path (`contextHealthAction`, `setInitAttempt`) and what mounts `.mapFallback`.
- `playwright.config.ts` ran `map-console-health`, `map-arrival-turn`, `map-arrival-card-pins`, `map-desktop-arrival-chrome` and `map-webgl-recovery` under `--project=chromium` as well, with no GL launch flags and with service workers allowed (see R43). Closed in R44, and fenced by `__tests__/playwrightProjects.test.ts`.

## Final run on the merge head

The loop ended at 40 iterations. The branch then merged `origin/main` at `d57629cc8` (13 commits, #1655 to #1664) as `643732e7d`. The run below is on that head: a keyless production build, the `chromium` project.

- Full suite at 4 workers (14 Sep 2026, load 55 to 78 from other lanes): 1004 passed, 65 failed, 20 skipped, 29.8 min. No skip is new on this branch; the one skip the base-to-head diff adds is `e2e/performance-budget-ab.spec.ts:196`, from main's #1648.
- Every red rerun once at 1 worker, plan-generating files one file per run with a 65 s gap: 71 tests, 41 passed, 30 failed. The 35 that turned green are timeouts under load and `/api/plans/generate` 429s on one shared IP.

### Still red after the rerun (30)

R6, parked under "Needs captain" (13): `mobile-first-run-onboarding.spec.ts:100` light and dark, `:138`, `:200`, `:221`; `price-caption-integrity.spec.ts:507` at 390 and 430; `ux-consent-chrome.spec.ts:399` at all six sizes. `:200` (returning native onboarding redirects to Tonight) is the same `/onboarding` document-request bounce.

Also red in the main red set at `aa6470eec` (10): `desktop-map-chrome-fit.spec.ts:316` (G1), `map-accessibility.spec.ts:240` (G1, R14 open), `map-near-me.spec.ts:19` (G3) and `:115` (G1), `mobile-map-controls.spec.ts:41` (G1), `mobile-the-local.spec.ts:4` (G2: the planner section is named by its "Describe the outing" heading and the input carries the same label, identical at base, main and head, so `getByLabel` finds two), `moment-photo-editor.spec.ts:38` (G5), `ui-consistency-layout.spec.ts:961` (G1), `web-push-prompt.spec.ts:131` (G1), `plan-single-stop.spec.ts:34` 2-stop (G4).

GL gap (1): `map-console-health.spec.ts:78`, then run under `--project=chromium` without the GL launch flags because `chromium`'s `testIgnore` did not list it. `map-tile-retry`, `map-arrival-turn`, `map-arrival-card-pins`, `map-desktop-arrival-chrome` and `map-webgl-recovery` had the same gap and passed here. Closed in R44.

Not in the main red set (6):
- `desktop-route-composition.spec.ts:10`: `getByTestId('tonight-screen')` resolves to two elements. Only main's #1661 (desktop rail) touched `app/tonight/TonightClient.tsx` and `page.tsx` since base; this branch did not.
- `mobile-heritage-ask.spec.ts:61`: the test timeout (120 s) runs out scrolling the Ask section's visible Send button into view. Only main's #1659 (Ask moved into Lore) touched this spec and that section since base.
- `mobile-map-tile-paint.spec.ts:77`: tiles painted in 23300 ms against the spec's own 20000 ms regression ceiling on a throttled cold map, under load 55 to 78.
- `mobile-plan-opening-layout.spec.ts:17`: the `.planPage__intro h1` font size and line height read as NaN. `.planPage__intro`, the plan page and the typography tokens are unchanged since base on both sides. Cause not found.
- `night-mode-chrome.spec.ts:71`: the plan status "3 stops we can stand behind, shaped by the outing you set below." never paints. The copy is unchanged at base, main and head (`components/plan/PlanComposer.tsx:1805`), so no plan answer arrived; it ran among other plan-generating specs on one IP.
- `plan-crawl-stops.spec.ts:30` 5-stop at 1440: no `POST /api/plans/generate` response in 180 s, after three other generations in the same file.

## Needs captain

- **The native first run never reaches `/onboarding`** (R6, 12 tests). This is a product bug on main since 7 Sep 2026.
  - Behaviour: #1632 moved the first-run branch into `public/theme-init.js`, which calls `window.location.replace("/onboarding")`. That is a document request. #1625 (merged two hours before) made `proxy.ts` answer every document request for `/onboarding` with a 307 to `/`, because the shell used to arrive by a client `router.replace`. So a genuine first launch stamps `pubmax:nativeFirstRun:routed:v1`, is sent to `/`, and lands on the landing page. It never sees onboarding, and the stamp stops every later launch from trying again. Probe on the rig: `resp: 307 /onboarding -> /`, then `routed=1 consumed=1`.
  - Why parked: both halves are outside this run's allowed paths (`proxy.ts` and `public/theme-init.js`), and each fix changes a documented rule in `app/AGENTS.md`.
  - Option A, recommended: `proxy.ts` lets a same-origin document navigation through (`Sec-Fetch-Site: same-origin`, or a same-origin `Referer` when that header is absent, because the iOS target is 15.0 and WKWebView sends `Sec-Fetch-*` only from 16.4). A typed or external arrival still gets the 307, so the B6 LCP fix holds, and `FirstRunOnboardingGate` still fails closed. Pin both in `__tests__/onboardingWebDocument.test.ts`.
  - Option B: `public/theme-init.js` leaves the first-run branch to `AppEntryRoute` (a client navigation, which the proxy allows) and keeps only the `/tonight` branch. The first launch paints the landing page for about 1.5 s again (the #1632 measurement).
  - Option C: the entry block sends `/onboarding` with a marker the proxy accepts. The URL then carries the marker, and a crafted link pays the old bounce.

## Verify reds

- `__tests__/vercelIgnoreCoverage.test.ts` > "no top-level directory over 5 MB is both unlisted and not a deploy input" fails with `{ '.gnhf': '12 MB' }` (149 MB by R7, 259 MB by R15, 288 MB by R17, 344 MB by R23, 348 MB by R24, 355 MB by R25, 366 MB by R26, 369 MB by R27, 371 MB by R28, 375 MB by R29 and R30, 427 MB by R32, R33 and R34, 440 MB by R35, 509 MB by R42). `.gnhf/` is the gnhf orchestrator's run directory for this repair, not product source. By R30 the same test also names `artifacts` (5.7 MB, all of it the git-ignored `artifacts/gnhf-rig`), because the rig directory crossed the 5 MB line. The fix is a `.gnhf` line in `.vercelignore` (or in `.gitignore`), which is outside this run's allowed paths. It is red only in a tree where the orchestrator runs.

## Appendix: main stable-failure set by root cause (origin/main aa6470eec, 197 tests)

Copied from the merge gate report. Each test failed at 6 workers and again at 2 workers. Format: group, `spec:line`, title. G1 and G2 (173 tests) are the genuine product or spec reds. G3 (timeout under load), G4 (plan-generate 429 on one shared IP) and G5 (local fetch fixture) were judged environmental.

| group | tests | cause | representative |
| --- | --- | --- | --- |
| G1 genuine, also red in CI | 140 | Product and spec disagree. The same test fails on CI's quiet Linux runner with Node 22. | `mobile-map-shell-matrix.spec.ts:58` expects 4 primary nav links, product renders 6. Also `mobile-button-system.spec.ts:28` (`.lpHero .screenActions a` 3, expected 2), `price-caption-integrity.spec.ts:336` (`Founded 1583`, expected `1583`), `price-submission.spec.ts:314` (`POST data is not a valid JSON object`: price posts are multipart since the bill attach). |
| G2 genuine by type, not reached in CI | 33 | Deterministic assertion, failed on both local runs. CI's shards 2 and 4 never reached it. | `mobile-v1-obstructions.spec.ts:47` (tab-bar reserve `132`, expected `64`, fails in 0 s). Also `mobile-shared-sheet-layout.spec.ts:108` (`absolute`, expected `fixed`). |
| G3 timeout under load | 18 | `Test timeout` or a long wait. Passed in CI or not reached. | `desktop-map-chrome-fit.spec.ts:240` (`Test timeout of 30000ms exceeded`, passed in CI). |
| G4 plan-generate 429 on one shared IP | 5 | Parallel workers on one IP spend the `/api/plans/generate` per-IP budget. `error-context.md` shows `status: Too many requests.` CI's shards run on separate runners. | `plan-single-stop.spec.ts:34` (passed in CI). |
| G5 local fetch fixture | 1 | `locator.evaluate: TypeError: Failed to fetch` in 0 s. Not reached in CI. | `moment-photo-editor.spec.ts:38` |

```
G1 genuine, also red in CI	a11y-core-journeys.spec.ts:115	discover: tonight
G1 genuine, also red in CI	a11y-keyboard-loop.spec.ts:314	/ says everything it means while still
G1 genuine, also red in CI	analytics-consent.spec.ts:143	rechecks consent when another prompt releases the budget
G1 genuine, also red in CI	analytics-consent.spec.ts:165	map prompt leaves the primary planning control usable
G1 genuine, also red in CI	analytics-consent.spec.ts:54	declining is remembered and sends nothing
G1 genuine, also red in CI	claim-no-birth-date.spec.ts:269	a member with no birth date reaches their first price on one tap
G1 genuine, also red in CI	crews-and-people.spec.ts:11	offers no crew surface anywhere on the page
G1 genuine, also red in CI	crews-and-people.spec.ts:36	structured invite failures render fallback copy
G1 genuine, also red in CI	crews-and-people.spec.ts:55	signed-out Social does not request or render a directory empty state
G1 genuine, also red in CI	dark-primary-surfaces.spec.ts:229	dark production landing, map, and venue sheet meet state contracts at 
G1 genuine, also red in CI	dark-primary-surfaces.spec.ts:229	dark production landing, map, and venue sheet meet state contracts at 
G1 genuine, also red in CI	design-taste-wave-1.spec.ts:97	semantic hues and sentence-case eyebrows hold in dark mode
G1 genuine, also red in CI	design-taste-wave-1.spec.ts:97	semantic hues and sentence-case eyebrows hold in light mode
G1 genuine, also red in CI	desktop-map-chrome-fit.spec.ts:240	1600px open planner keeps toolbar search and Clear search beyond the r
G1 genuine, also red in CI	desktop-map-chrome-fit.spec.ts:311	1440px planner hands ownership to venue and Back restores composed sta
G1 genuine, also red in CI	desktop-map-chrome-fit.spec.ts:599	1023px first-run location prompt owns centre while status yields to it
G1 genuine, also red in CI	desktop-map-chrome-fit.spec.ts:599	641px first-run location prompt owns centre while status yields to its
G1 genuine, also red in CI	desktop-map-chrome-fit.spec.ts:599	800px first-run location prompt owns centre while status yields to its
G1 genuine, also red in CI	drink-chip-controls.spec.ts:188	390px fare-zone rows agree through selection and reset
G1 genuine, also red in CI	exception-capture.spec.ts:68	an uncaught crash reaches PostHog, named by surface and carrying no us
G1 genuine, also red in CI	first-run-tour-placement.spec.ts:5	mobile first-run tour leaves the map centre visible
G1 genuine, also red in CI	founding-members.spec.ts:176	is shown no founding surface anywhere
G1 genuine, also red in CI	landmark-story-sheet.spec.ts:277	phone 390: a pub opened from the story has the story as its Back
G1 genuine, also red in CI	launch-phone-controls.spec.ts:116	/about fits and stays tappable at 360/390/430
G1 genuine, also red in CI	launch-phone-controls.spec.ts:116	/discover fits and stays tappable at 360/390/430
G1 genuine, also red in CI	launch-phone-controls.spec.ts:116	/login fits and stays tappable at 360/390/430
G1 genuine, also red in CI	launch-phone-controls.spec.ts:116	/messages fits and stays tappable at 360/390/430
G1 genuine, also red in CI	launch-phone-controls.spec.ts:116	/pubs fits and stays tappable at 360/390/430
G1 genuine, also red in CI	launch-phone-controls.spec.ts:116	/social fits and stays tappable at 360/390/430
G1 genuine, also red in CI	map-accessibility.spec.ts:195	updates open venue list after map movement and a venue-kind filter
G1 genuine, also red in CI	map-accessibility.spec.ts:236	drops old base-pub rows during a disjoint pan before the next shard fe
G1 genuine, also red in CI	map-accessibility.spec.ts:300	keeps desktop drawer focus inside and restores chosen venue on Escape
G1 genuine, also red in CI	map-accessibility.spec.ts:383	keeps a rapid reselection open after close history settles
G1 genuine, also red in CI	map-console-health.spec.ts:78	/map stays console-healthy across repeated /map↔/feed navigation
G1 genuine, also red in CI	map-filters-bottom-nav.spec.ts:32	analytics consent stays hidden behind an open filters sheet
G1 genuine, also red in CI	map-near-me.spec.ts:115	keeps the expanded city-status feed inside an 800px viewport
G1 genuine, also red in CI	map-performance.spec.ts:43	landing night choice reaches a usable filtered mobile map
G1 genuine, also red in CI	map-search-no-results.spec.ts:160	mobile dark normal miss evidence
G1 genuine, also red in CI	map-search-no-results.spec.ts:160	mobile dark reduced miss evidence
G1 genuine, also red in CI	map-story.spec.ts:120	names The Dove price publisher in Overview and its Asahi row
G1 genuine, also red in CI	map-tile-retry.spec.ts:43	/map recovers silently from a transient tile outage on desktop
G1 genuine, also red in CI	messages-desktop.spec.ts:105	messages use inbox and thread panes at 1024px in dark mode
G1 genuine, also red in CI	messages-desktop.spec.ts:105	messages use inbox and thread panes at 1024px in light mode
G1 genuine, also red in CI	messages-desktop.spec.ts:105	messages use inbox and thread panes at 1280px in dark mode
G1 genuine, also red in CI	messages-desktop.spec.ts:105	messages use inbox and thread panes at 1280px in light mode
G1 genuine, also red in CI	messages-desktop.spec.ts:105	messages use inbox and thread panes at 1440px in dark mode
G1 genuine, also red in CI	messages-desktop.spec.ts:105	messages use inbox and thread panes at 1440px in light mode
G1 genuine, also red in CI	messages-desktop.spec.ts:105	messages use inbox and thread panes at 1920px in dark mode
G1 genuine, also red in CI	messages-desktop.spec.ts:105	messages use inbox and thread panes at 1920px in light mode
G1 genuine, also red in CI	mobile-activity.spec.ts:56	keeps the empty retention state and nav utilities thumb-safe
G1 genuine, also red in CI	mobile-activity.spec.ts:82	empty state feeds the growth loop without clipping
G1 genuine, also red in CI	mobile-activity.spec.ts:91	populated notifications expose thumb-safe actor and subject links
G1 genuine, also red in CI	mobile-bottom-nav.spec.ts:111	gated Social stays out of the primary tab row
G1 genuine, also red in CI	mobile-bottom-nav.spec.ts:46	hides while the planner bottom sheet owns the bottom edge
G1 genuine, also red in CI	mobile-bottom-nav.spec.ts:65	Map tab routes to /map and exposes the map search control
G1 genuine, also red in CI	mobile-bottom-nav.spec.ts:89	Out tab routes to /out
G1 genuine, also red in CI	mobile-bottom-nav.spec.ts:99	create action opens Moment with the live return path
G1 genuine, also red in CI	mobile-button-system.spec.ts:28	390px dark: landing and Pub Pal controls stay uniform and clear
G1 genuine, also red in CI	mobile-button-system.spec.ts:28	390px light: landing and Pub Pal controls stay uniform and clear
G1 genuine, also red in CI	mobile-button-system.spec.ts:28	430px dark: landing and Pub Pal controls stay uniform and clear
G1 genuine, also red in CI	mobile-button-system.spec.ts:28	430px light: landing and Pub Pal controls stay uniform and clear
G1 genuine, also red in CI	mobile-button-system.spec.ts:378	768px: the map zoom pair is pressable and the status banner keeps its 
G1 genuine, also red in CI	mobile-discover-coverage.spec.ts:11	mobile Discover shows Night Area evidence states without promising rou
G1 genuine, also red in CI	mobile-first-run-onboarding.spec.ts:110	first-run onboarding is composed at 390x844 in dark
G1 genuine, also red in CI	mobile-first-run-onboarding.spec.ts:110	first-run onboarding is composed at 390x844 in light
G1 genuine, also red in CI	mobile-first-run-onboarding.spec.ts:148	native first run hands one useful Plan to the contextual push ask
G1 genuine, also red in CI	mobile-first-run-onboarding.spec.ts:231	Skip releases onboarding budget for the next Plan but never prompts on
G1 genuine, also red in CI	mobile-first-run-tour.spec.ts:33	presents thumb-safe onboarding controls before first value
G1 genuine, also red in CI	mobile-invite-map-prompt.spec.ts:211	Maybe RSVP reveals the canonical one-stop map handoff
G1 genuine, also red in CI	mobile-invite-map-prompt.spec.ts:225	failed guest RSVP stays on invite without a map handoff
G1 genuine, also red in CI	mobile-invite-map-prompt.spec.ts:250	guest RSVP rejects a success response without a valid summary
G1 genuine, also red in CI	mobile-invite-map-prompt.spec.ts:70	guest RSVP reveals one ordered map handoff that fits mobile
G1 genuine, also red in CI	mobile-map-controls.spec.ts:30	mobile map controls: top bar, drink filters, and coordinated layers ar
G1 genuine, also red in CI	mobile-map-first-visit.spec.ts:10	320px cold map keeps First visit as the only lower surface
G1 genuine, also red in CI	mobile-map-first-visit.spec.ts:10	390px cold map keeps First visit as the only lower surface
G1 genuine, also red in CI	mobile-map-first-visit.spec.ts:10	430px cold map keeps First visit as the only lower surface
G1 genuine, also red in CI	mobile-map-search.spec.ts:14	mobile top-bar search filters the map and clears only the query
G1 genuine, also red in CI	mobile-map-shell-matrix.spec.ts:58	coordinated map shell 320x568 dark
G1 genuine, also red in CI	mobile-map-shell-matrix.spec.ts:58	coordinated map shell 320x568 light
G1 genuine, also red in CI	mobile-map-shell-matrix.spec.ts:58	coordinated map shell 375x812 light
G1 genuine, also red in CI	one-tap-measure.spec.ts:149	a pint logged through the same door still says pint
G1 genuine, also red in CI	one-tap-measure.spec.ts:89	a half logged through the one-tap door travels as a half and moves no 
G1 genuine, also red in CI	plan-invite.spec.ts:189	invite loop: guest RSVP, host Remove via cookie path, guest map handof
G1 genuine, also red in CI	plan-loop.spec.ts:130	host still gets night mode ambushed at their own plan's start time
G1 genuine, also red in CI	plan-loop.spec.ts:7	concierge picks become a public Plan that a mate joins with only a nam
G1 genuine, also red in CI	price-caption-integrity.spec.ts:336	historic disclosures retain the full 1583 text at 390px
G1 genuine, also red in CI	price-caption-integrity.spec.ts:336	historic disclosures retain the full 1583 text at 430px
G1 genuine, also red in CI	price-caption-integrity.spec.ts:404	mobile map renders story qualifier and attribution at 390px
G1 genuine, also red in CI	price-caption-integrity.spec.ts:404	mobile map renders story qualifier and attribution at 430px
G1 genuine, also red in CI	price-caption-integrity.spec.ts:498	first-run qualifiers render on the real page at 390px
G1 genuine, also red in CI	price-caption-integrity.spec.ts:498	first-run qualifiers render on the real page at 430px
G1 genuine, also red in CI	price-evidence-missions.spec.ts:237	map venue sheet shows the mission and prints the write-back receipt
G1 genuine, also red in CI	price-evidence-missions.spec.ts:266	a logged mission takes its own card away
G1 genuine, also red in CI	price-evidence-missions.spec.ts:287	the credit sentence reads as one line of prose at 390
G1 genuine, also red in CI	price-evidence-missions.spec.ts:323	the credit sentence and its link share one row on a desktop width
G1 genuine, also red in CI	price-evidence-missions.spec.ts:358	map sheet keeps one-tap prices when the mission is missing
G1 genuine, also red in CI	price-evidence-missions.spec.ts:382	the map sheet locks the mission's own drink, not the lane's
G1 genuine, also red in CI	price-submission.spec.ts:314	a drinker logs tonight's price after completing private signup
G1 genuine, also red in CI	price-submission.spec.ts:577	a person can log soft-drink, alcohol-free and coffee prices from the p
G1 genuine, also red in CI	profile-avatar.spec.ts:247	retries a failed avatar after the browser reconnects
G1 genuine, also red in CI	profile-photo-crop.spec.ts:448	an upload keeps the editor open with the fresh image in place
G1 genuine, also red in CI	qa-button-sizing.spec.ts:24	desktop map camera and favourite-pint controls meet the tap floor
G1 genuine, also red in CI	quality-floor.spec.ts:155	quality floor: the non-alcoholic filter checkbox flips its checked sta
G1 genuine, also red in CI	site-nav-more.spec.ts:3	More menu stays usable in a short desktop viewport
G1 genuine, also red in CI	social-composer.spec.ts:230	account-bound drafts isolate text and photo while two tabs warn
G1 genuine, also red in CI	social-composer.spec.ts:261	private visibility and comment policy survive create, owner outbox, an
G1 genuine, also red in CI	social-composer.spec.ts:526	1280px dark composer has no overflow and passes keyboard and axe
G1 genuine, also red in CI	social-composer.spec.ts:526	1280px light composer has no overflow and passes keyboard and axe
G1 genuine, also red in CI	social-composer.spec.ts:526	320px dark composer has no overflow and passes keyboard and axe
G1 genuine, also red in CI	social-composer.spec.ts:526	320px light composer has no overflow and passes keyboard and axe
G1 genuine, also red in CI	social-composer.spec.ts:526	390px dark composer has no overflow and passes keyboard and axe
G1 genuine, also red in CI	social-composer.spec.ts:526	390px light composer has no overflow and passes keyboard and axe
G1 genuine, also red in CI	social-composer.spec.ts:526	430px dark composer has no overflow and passes keyboard and axe
G1 genuine, also red in CI	social-composer.spec.ts:526	430px light composer has no overflow and passes keyboard and axe
G1 genuine, also red in CI	social-composer.spec.ts:78	verified composer preserves failed photo draft, records consent choice
G1 genuine, also red in CI	social-shell.spec.ts:132	preview shows one safe boundary and never requests or leaks protected 
G1 genuine, also red in CI	social-shell.spec.ts:449	feed retry repeats only the failed chronological read
G1 genuine, also red in CI	social-shell.spec.ts:552	invalid Social URL state resolves to the safe canonical route
G1 genuine, also red in CI	tonight-share-failure.spec.ts:9	desktop Tonight share failure keeps status below its action
G1 genuine, also red in CI	tonight-share-failure.spec.ts:9	mobile Tonight share failure keeps status below its action
G1 genuine, also red in CI	tonight-trusted-ui.spec.ts:191	keeps the main list before Deals/Music and above the mobile tab bar
G1 genuine, also red in CI	tonight-trusted-ui.spec.ts:224	renders honest unknown freshness, never request time
G1 genuine, also red in CI	tonight-vibe-chips.spec.ts:18	tonight vibe chips use sentence case @1280
G1 genuine, also red in CI	tonight-vibe-chips.spec.ts:18	tonight vibe chips use sentence case @390
G1 genuine, also red in CI	tonight.spec.ts:650	a night of only excluded rows reads as the honest quiet night
G1 genuine, also red in CI	ui-consistency-layout.spec.ts:901	profile Options expose working existing actions
G1 genuine, also red in CI	ui-consistency-layout.spec.ts:961	capture UI consistency evidence
G1 genuine, also red in CI	ux-consent-chrome.spec.ts:117	mobile consent never covers the tab bar, before or after dismiss
G1 genuine, also red in CI	ux-consent-chrome.spec.ts:390	consent never covers first-run onboarding @320x568
G1 genuine, also red in CI	ux-consent-chrome.spec.ts:390	consent never covers first-run onboarding @320x844
G1 genuine, also red in CI	ux-consent-chrome.spec.ts:390	consent never covers first-run onboarding @360x640
G1 genuine, also red in CI	ux-consent-chrome.spec.ts:390	consent never covers first-run onboarding @360x844
G1 genuine, also red in CI	ux-consent-chrome.spec.ts:390	consent never covers first-run onboarding @390x844
G1 genuine, also red in CI	ux-consent-chrome.spec.ts:390	consent never covers first-run onboarding @430x932
G1 genuine, also red in CI	venue-acceptance.spec.ts:68	Venue actions fit 320px and 390px
G1 genuine, also red in CI	view-mode.spec.ts:7	legacy view-mode state cannot replace the current mobile navigation
G1 genuine, also red in CI	w3-getting-there.spec.ts:105	announces location progress and retries a failed route request
G1 genuine, also red in CI	w3-getting-there.spec.ts:16	keeps location private, supports forgetting, and shows useful routes
G1 genuine, also red in CI	wanted-wave-a.spec.ts:42	plan describe-first stays usable with Wanted chip lane absent when sig
G1 genuine, also red in CI	web-push-prompt.spec.ts:131	installed PWA asks for the honest London brief only after a useful pla
G2 genuine by type, not reached in CI	map-tile-retry.spec.ts:95	/map still shows the banner when tiles never come back
G2 genuine by type, not reached in CI	mobile-map-shell-matrix.spec.ts:267	London basemap hierarchy at z10 z12 z14 z16 dark
G2 genuine by type, not reached in CI	mobile-map-shell-matrix.spec.ts:267	London basemap hierarchy at z10 z12 z14 z16 light
G2 genuine by type, not reached in CI	mobile-map-shell-matrix.spec.ts:58	coordinated map shell 375x812 dark
G2 genuine by type, not reached in CI	mobile-map-shell-matrix.spec.ts:58	coordinated map shell 390x844 dark
G2 genuine by type, not reached in CI	mobile-map-shell-matrix.spec.ts:58	coordinated map shell 390x844 light
G2 genuine by type, not reached in CI	mobile-map-shell-matrix.spec.ts:58	coordinated map shell 430x932 dark
G2 genuine by type, not reached in CI	mobile-map-shell-matrix.spec.ts:58	coordinated map shell 430x932 light
G2 genuine by type, not reached in CI	mobile-permalink.spec.ts:63	mobile unknown Pint Drop permalink has a tappable empty-state action a
G2 genuine by type, not reached in CI	mobile-round-lifecycle.spec.ts:9	mobile Round lifecycle: join, copy code, add a pub, and host closes
G2 genuine by type, not reached in CI	mobile-rounds-index.spec.ts:30	mobile Rounds index explains link-based joining and routes to the map
G2 genuine by type, not reached in CI	mobile-shared-sheet-layout.spec.ts:108	mobile venue footer stays pinned and actionable at every sheet detent
G2 genuine by type, not reached in CI	mobile-shared-sheet-layout.spec.ts:163	mobile planner and contextual portal sheets retain the canonical botto
G2 genuine by type, not reached in CI	mobile-shared-sheet-layout.spec.ts:188	desktop keeps the legacy inline venue drawer without the mobile portal
G2 genuine by type, not reached in CI	mobile-shared-sheet-layout.spec.ts:219	mobile venue sheet dark reduced-motion evidence
G2 genuine by type, not reached in CI	mobile-shared-sheet-layout.spec.ts:219	mobile venue sheet light reduced-motion evidence
G2 genuine by type, not reached in CI	mobile-the-local.spec.ts:4	mobile Describe the outing builds one grounded route without camera fl
G2 genuine by type, not reached in CI	mobile-tonight.spec.ts:31	mobile Tonight screen keeps share, filters, and rows tappable
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:198	320px card stays within 30% without internal scrolling
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:198	390px card stays within 30% without internal scrolling
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:198	430px card stays within 30% without internal scrolling
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:230	320px Legacy Mode card stays within 30% with enlarged text
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:253	is a compact non-modal card while map stays visible and interactive
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:321	retains the full modal Safari instruction sheet
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:351	320px exposes real trailing overflow, then removes fade at the reachab
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:375	390px shows Last train in full on first open
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:375	430px shows Last train in full on first open
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:47	320px has one tab-bar reserve and no oversized layout block
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:47	390px has one tab-bar reserve and no oversized layout block
G2 genuine by type, not reached in CI	mobile-v1-obstructions.spec.ts:47	430px has one tab-bar reserve and no oversized layout block
G2 genuine by type, not reached in CI	mobile-venue-sheet-tabs.spec.ts:385	a real 390px touch swipe reaches the final Venue tab
G2 genuine by type, not reached in CI	near-desk-mode.spec.ts:59	deep-links desk mode and names a thin locality honestly
G2 genuine by type, not reached in CI	near-venue-acceptance.spec.ts:27	Near separates browsing from permanent Venue acceptance
G3 timeout under load	analytics-consent.spec.ts:81	accepting starts ingest, captures a route change, and does not ask aga
G3 timeout under load	desktop-map-chrome-fit.spec.ts:240	1024px open planner keeps toolbar search and Clear search beyond the r
G3 timeout under load	desktop-map-chrome-fit.spec.ts:240	1280px open planner keeps toolbar search and Clear search beyond the r
G3 timeout under load	desktop-map-chrome-fit.spec.ts:240	1440px open planner keeps toolbar search and Clear search beyond the r
G3 timeout under load	desktop-map-chrome-fit.spec.ts:455	1440px Plan an outing takes ownership from an open venue
G3 timeout under load	desktop-map-chrome-fit.spec.ts:486	1440px loaded route opens its first venue without a deferred planner h
G3 timeout under load	desktop-map-chrome-fit.spec.ts:565	1440px reduced motion swaps desktop drawer ownership immediately
G3 timeout under load	landmark-story-sheet.spec.ts:323	desktop 1440: the story takes the left drawer and the chrome leaves it
G3 timeout under load	map-near-me.spec.ts:19	keeps Near me actionable at 1600px with consent decided and tour unsee
G3 timeout under load	map-search-no-results.spec.ts:160	mobile light reduced miss evidence
G3 timeout under load	map-search-no-results.spec.ts:62	mobile miss stays visible, announces once, stays private, and keeps ke
G3 timeout under load	map-webgl-recovery.spec.ts:18	/map preventDefaults webglcontextlost and arms recovery without full f
G3 timeout under load	mobile-map-list-obstruction.spec.ts:128	planner action yields to venue list and returns at 390px
G3 timeout under load	mobile-map-list-obstruction.spec.ts:128	planner action yields to venue list and returns at 430px
G3 timeout under load	mobile-moment-flow.spec.ts:12	keeps a private draft through refresh and separates Pint Drop
G3 timeout under load	price-evidence-missions.spec.ts:190	signed-in /near shows one mission, submits, and prints the write-back 
G3 timeout under load	price-evidence-missions.spec.ts:222	a failed mission write stays on /near
G3 timeout under load	second-drinker-confirm.spec.ts:159	a second drinker confirms £4.50 and the Overview flips from logged-onc
G4 plan-generate 429 on one shared IP	plan-invite-surface.spec.ts:58	M04: rotating the invite link re-points the WhatsApp share href
G4 plan-generate 429 on one shared IP	plan-invite.spec.ts:113	Copy invite link shows for the host's own session and never for an ano
G4 plan-generate 429 on one shared IP	plan-single-stop.spec.ts:34	describe-first builds a real 1-stop outing at 390px
G4 plan-generate 429 on one shared IP	plan-single-stop.spec.ts:34	describe-first builds a real 2-stop outing at 390px
G4 plan-generate 429 on one shared IP	trusted-handoff-state-matrix.spec.ts:106	valid restored PlanningIntent → /plan renders fail-soft at 390w
G5 local fetch fixture	moment-photo-editor.spec.ts:38	edits with first-party crop, filter, text, and draw tools
```
