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
  - `:111` said gated Social stays out of the tab row (#1170). #1247 revived Social as one of six tabs, and `__tests__/mobileTabBar.test.ts` keeps it visible as a preview when gated.
- [x] R2 `mobile-map-shell-matrix.spec.ts` and `view-mode.spec.ts` (11 fixed): the specs lied about the shipped map shell.
  - `mobile-map-shell-matrix.spec.ts` "coordinated map shell" (8 tests) expected 4 tabs. The bar has six: Now, Map, Places, Out, Social, You (`components/nav/navigationModel.ts`).
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

## Needs captain

- **The native first run never reaches `/onboarding`** (R6, 12 tests). This is a product bug on main since 7 Sep 2026.
  - Behaviour: #1632 moved the first-run branch into `public/theme-init.js`, which calls `window.location.replace("/onboarding")`. That is a document request. #1625 (merged two hours before) made `proxy.ts` answer every document request for `/onboarding` with a 307 to `/`, because the shell used to arrive by a client `router.replace`. So a genuine first launch stamps `pubmax:nativeFirstRun:routed:v1`, is sent to `/`, and lands on the landing page. It never sees onboarding, and the stamp stops every later launch from trying again. Probe on the rig: `resp: 307 /onboarding -> /`, then `routed=1 consumed=1`.
  - Why parked: both halves are outside this run's allowed paths (`proxy.ts` and `public/theme-init.js`), and each fix changes a documented rule in `app/AGENTS.md`.
  - Option A, recommended: `proxy.ts` lets a same-origin document navigation through (`Sec-Fetch-Site: same-origin`, or a same-origin `Referer` when that header is absent, because the iOS target is 15.0 and WKWebView sends `Sec-Fetch-*` only from 16.4). A typed or external arrival still gets the 307, so the B6 LCP fix holds, and `FirstRunOnboardingGate` still fails closed. Pin both in `__tests__/onboardingWebDocument.test.ts`.
  - Option B: `public/theme-init.js` leaves the first-run branch to `AppEntryRoute` (a client navigation, which the proxy allows) and keeps only the `/tonight` branch. The first launch paints the landing page for about 1.5 s again (the #1632 measurement).
  - Option C: the entry block sends `/onboarding` with a marker the proxy accepts. The URL then carries the marker, and a crafted link pays the old bounce.

## Verify reds

- `__tests__/vercelIgnoreCoverage.test.ts` > "no top-level directory over 5 MB is both unlisted and not a deploy input" fails with `{ '.gnhf': '12 MB' }`. `.gnhf/` is the gnhf orchestrator's run directory for this repair, not product source. The fix is a `.gnhf` line in `.vercelignore` (or in `.gitignore`), which is outside this run's allowed paths. It is red only in a tree where the orchestrator runs.

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
