# Mobile hidden qualifier audit

Reviewed 30 July 2026.

Rerun the broad source sweep with:

```bash
rg -n -C 8 'display:\s*none|visibility:\s*hidden' app components --glob '*.css'
```

For each result, inspect its enclosing media query. The inventory below includes every result inside a `max-width`, `hover: none`, or `pointer: coarse` mobile rule. It excludes base rules and minimum-width-only desktop rules.

This source sweep is supplementary discovery only. CSS enumeration cannot prove that a component is mounted, that its text reaches the rendered page, or that an ancestor leaves it visible. Acceptance uses rendered production pages at 390px and 430px.

PROSE MAY BE BOUNDED, BUT ITS FULL QUALIFIED TEXT MUST REMAIN DISCLOSABLE.

The bounded heritage cards now use the existing native `details` disclosure pattern. Their closed state is a two-line visual preview of the same complete text node, and Show more removes that clamp. Dates, uncertainty, present-day limits, and other attached qualifiers therefore remain intact in HTML and reachable without natural-language parsing. Explicit qualifier fields were considered and judged UNNECESSARY, not deferred, because disclosure keeps the full text present and exposes it through a native control.

## Evidence correction

The previous `45 passed` statement was inaccurate as rendered-coverage evidence. Of those 45 checks, 39 used synthetic `page.setContent` markup, and several targeted controls that production does not mount at phone widths. Those checks are CSS fixtures, not proof of shipped layout. They are now named `fixture-only` in the test report and are not counted as route coverage.

The fixture-derived ratios 5.80:1, 6.64:1, 6.30:1, and 5.32:1 were also previously presented as shipped rendered measurements. That presentation is retracted. Production-route measurement on the real landing page, map, and opened venue sheet at both 390px and 430px gives:

- landing primary 6.64:1 and placeholder 6.34:1;
- map active chip 6.64:1 and disabled chip 5.80:1;
- opened-sheet price plaque 6.30:1, active tab 6.64:1, primary action 5.96:1, focus outline 4.91:1, and hover tab 13.11:1.

These figures come from computed paint composited through each rendered element's real ancestor surfaces. None is fixture-only.

## Mobile qualifiers rendered and verified

| File and selector | Breakpoint | Reason |
| --- | --- | --- |
| `app/onboarding/onboarding.css` `.firstRunAreaList small` | 360px | `PUBMAXX reviewed` is source status for each displayed route area. |
| `app/onboarding/onboarding.css` `.firstRunCompanionChoice small` | 360px | Choice note explains the visible Pal label and affects the selection. |
| `app/pal/pal.css` `.palTopbar > :nth-child(2):not(:last-child)` | 760px | `N of 5` is setup progress status, so mobile keeps the three-column onboarding top bar. |
| `app/globals.css` `.bandOnboardingChip span` | 640px | Longest shipped story keeps its closing conditions in the mounted phone map. |
| `app/globals.css`, `components/mobile/mobileMapShell.css` `.maplibregl-ctrl-attrib` | 640px | Map-level OpenStreetMap credit remains readable above phone navigation. |

## Mobile surfaces not fixed

| File and selector | Render ownership | Decision |
| --- | --- | --- |
| `components/map/cityStatusBanner.css` `.cityStatusBannerCopy` | `PubMap` mounts `CityStatusBanner` only when `!mobileViewport`. | No phone change required. Desktop banner and expanded sheet now share a content-sized flow stack, so wrapped headlines determine following-sheet geometry. Phone service-status presentation remains a separate product decision. |
| `components/map/cityStatusBanner.css` `.cityStatusBannerDismiss` | Same desktop-only `CityStatusBanner` boundary. | No phone change required. |
| `components/map/citySuggestBanner.css` `.citySuggestBannerCopy` | `PubMap` mounts `CitySuggestBanner` only when `!mobileViewport`. | No phone change required. Phone city-suggestion presentation remains a separate product decision. |

## Rendered acceptance

`e2e/price-caption-integrity.spec.ts` separates production-route checks from fixture-only CSS checks:

- `/map/glasgow?band=subcrawl` at 390px and 430px renders the exact 331-character story, expands the live MapLibre attribution control, and finds the exact `Pub data © OpenStreetMap contributors (ODbL)` credit above phone navigation.
- Native `/onboarding` at 390px and 430px renders all three exact `PUBMAXX reviewed` source labels, then all six exact companion notes.
- `/pal` at 390px and 430px renders exact setup progress from the live onboarding state.
- `/historic` and `/borough/tower-hamlets` at 390px and 430px render The Grapes as a bounded preview, keep its exact text through `since 1583` in the page, expose it through Show more, and leave era, source, and following action clear of the expanded disclosure.

City status and city suggestion have no mobile rendered-output assertion because those components are not mounted there and are explicitly outside this remediation.

`e2e/dark-primary-surfaces.spec.ts` opens `/`, `/map`, and `/map?sel=venue-xjf3n0` in dark mode at both phone widths. It measures the real opened sheet's visible price plaque, then drives Add price through the signed-out gate. Each run attaches its rendered, composited contrast ratios as JSON. The same file drives the desktop map with a long user-entered query and a long major city-status headline.

Fixture-only cases retained for CSS isolation:

| Selector group | Why route coverage is separate |
| --- | --- |
| `.dealsTonightDetail` | Offer rows depend on a live listing payload; fixture verifies wrapping only. |
| `.mapToolbarSearchStatusCopy` | Desktop recovery state requires a failed search provider; phone map does not mount this toolbar. |
| `.mapSearchSuggestPrice*` | Suggestion price provenance depends on a matching priced search result. |
| `.mapVenueList*Price*` | List price provenance depends on current lens and venue data. |
| `.tonightLaneCollapsedChecked` | Collapsed lane is desktop-only; phone mounts Tonight inside its sheet. |
| `.tonightLaneChecked`, `.tonightLaneCardTitle`, `.tonightLaneCardSource` | Rows depend on a current listings payload; fixture verifies CSS only. |
| `.bandOnboardingChip span` | Real route coverage exists at 390px and 430px; the synthetic 360px and duplicate width checks remain fixture-only. |

Unmounted phone surfaces are inventoried separately: desktop `.mapToolbarSearchStatusCopy`, collapsed `.tonightLaneCollapsedChecked`, `.mapHeroCard`, `.cityStatusBannerCopy`, `.cityStatusBannerDismiss`, and `.citySuggestBannerCopy`. No synthetic assertion against them is counted as phone rendering.

## Hidden cases retained

| File and selector | Breakpoint | Reason |
| --- | --- | --- |
| `app/onboarding/onboarding.css` `body:has(.firstRunOnboarding) .mobileTabBar` | 760px | Full-screen setup owns navigation until setup ends. |
| `app/onboarding/onboarding.css` `.firstRunBrand span` | 760px | Wordmark remains; secondary brand lockup is decorative. |
| `app/globals.css` `.venueHoverCard` | coarse pointer or 700px | Touch selection opens the full venue sheet with same content. |
| `app/globals.css` `.mapHeroCard` | 640px | Desktop teaser is duplicated by story destinations available from phone map controls. |
| `app/globals.css` MapLibre bottom-left control group | 640px | App-owned phone controls replace zoom chrome; map-level attribution stays visible above phone navigation. |
| `app/globals.css` `.poiToggleDesktop, .placeStoriesDesktop` | 640px | Layers sheet owns both controls on phones. |
| `app/globals.css` floating-nav auth labels | 640px | Mobile map shell replaces the floating desktop navigation. |
| `components/seo/factLayer.css` `.cityFactRegion` | 1023px | Full-screen map omits duplicated fact prose; standalone area and index pages retain it. |
| `components/nav/siteNav.css` `.siteNavCmdk` | 900px | Compact palette icon returns at tablet width; phone navigation and search own smaller widths. |
| `components/nav/siteNav.css` `.siteNavLinks` | 640px | Bottom tab bar duplicates primary destinations. |
| `components/nav/siteNav.css` `.siteNavBar .authUser` | 640px | Profile destination exists in bottom navigation. |
| `components/nav/siteNav.css` phone `.siteNavCmdk` | 640px | Phone search entry replaces hardware-keyboard hint. |
| `components/nav/siteNav.css` `.siteNavMore` | 640px | Bottom navigation and page actions duplicate its destinations. |
| `components/nav/siteNavMoment.css` `.siteNavMoment` | 640px | Raised bottom-tab Moment action is the same destination. |
| `components/pubs/pubsGallery.css` `.pubsCardShelf li span` | 640px | Closed drink-category identity remains in labelled glyphs and list accessible name. |
| `components/mobile/mobileMapShell.css` desktop map chrome group | 640px | Mobile shell re-homes search, city, TfL, Tonight, price, layers, and camera actions. |
| `components/mobile/mobileMapShell.css` `.mapCameraControls` | 640px | MapLibre compass is the sole phone camera recovery. |
| `components/mobile/mobileMapShell.css` MapLibre top-right group under a sheet | 640px | Open sheet covers and disables the duplicated compass temporarily. |
| `components/mobile/mobileMapShell.css` MapLibre zoom buttons | 640px | Touch pinch and app camera controls replace zoom buttons. |
| `components/mobile/mobileMapShell.css` `.mobileMapRail::-webkit-scrollbar` | 640px | Scrollbar chrome is decorative; rail remains horizontally scrollable. |
| `components/mobile/mobileMapShell.css` `.mobileSharedSheetFooter:empty` | 640px | Empty layout slot has no content. |
| `components/mobile/mobileMapShell.css` `.mobilePlannerIntentChips::-webkit-scrollbar` | 640px | Scrollbar chrome is decorative; chips remain scrollable. |
| `components/map/mapToolbar.css` desktop extras group | 641px to 900px | Favourite, conditions, and zone controls have compact or sheet destinations. |
| `components/map/mapToolbar.css` `.mapToolbarDesktopExtras` | 640px | Phone filters sheet duplicates these controls. |
| `components/map/mapToolbar.css` `.planBtnFull` | 640px | Short visible label and full `aria-label` preserve the same action. |
| `components/map/citySwitcher.css` `.citySwitcherLabelFull` | 641px to 900px | City code is visible and full city name remains in accessible name and menu. |
| `components/map/citySwitcher.css` `.citySwitcherLabelFull` | 640px | City code is visible and full city name remains in accessible name and menu. |
| `components/map/mapVenueList.css` `.mapVenueListToggle` | 640px | Layers sheet provides the same list-view action. |
| `components/map/spillComposer.css` `.spillCameraFrame` | 640px | Decorative camera illustration is hidden; both labelled capture actions remain. |
| `components/map/mapPriceControl.css` `.mapPriceControl--map` | 640px | Phone filters sheet owns price controls. |
| `components/map/mapPriceControl.css` `.mapPriceLegendFull` | 640px | Compact symbols remain visible; full key is in button accessible name and disclosed panel. |
| `components/map/venueSheet.css` `.venueTabFull` | 640px | Short visible tab label and full accessible name identify same section. |
| `components/map/tonightOverlayChip.css` overlay chip under detail or planning | 640px | Venue or planning sheet owns same screen region and context. |
| `components/landing/landing.css` `.lpPrimaryNav` | 960px | Compact landing navigation replaces desktop link row. |
| `components/landing/landing.css` extra `.thamesHeroPin` items | 700px | Hero pins are decorative map texture. |
| `components/landing/landing.css` `.thamesHeroPinPlace, .thamesHeroPinPrice` | 700px | Hero figures are decorative examples; product price claims live beyond the CTA. |
| `components/landing/landing.css` fourth `.thamesHeroPin` | 430px | Decorative density reduces on narrower screens. |
| `components/landing/landing.css` `.lpNavActions .authUserNav` | 350px | Account destination remains in bottom navigation. |
| `app/feed/feed.css` phone compose CTAs | 640px | Raised bottom-tab compose action duplicates both hidden CTAs. |
| `app/feed/feed.css` `.feedReactLabel` | 540px | Emoji, count, title, and full button accessible name preserve the reaction. |
| `app/pal/pal.css` `body:has(.palOnboarding) .mobileTabBar` | 760px | Full-screen Pal setup owns navigation until completion or Skip Pal. |
| `app/pal/pal.css` `.palOnboardingActions > button:not(.palPrimary)` | 760px | Top-bar Back and Skip Pal actions remain visible; primary action owns bottom row. |
| `app/auth/auth.css` `.authSignInLabelFull` | 720px | Short provider label and full button accessible name preserve action. |
| `app/auth/auth.css` `.authSignInLabelShort` | 480px | Stacked phone buttons restore full provider label. |
| `app/auth/auth.css` `.authUserNav .authCompactLabel` | 641px to 900px | Icon trigger retains full accessible name in dense tablet band. |
| `app/discover/discover.css` `.leaderboardArea` | 560px | Area is identity metadata, not price authority; pub destination carries full venue context. |
| `app/discover/discover.css` `.catShowcase__hint` | 560px | Whole card remains a labelled link to map; hint duplicates link behavior. |
| `app/discover/discover.css` `.discoverCuisineChips::-webkit-scrollbar` | 560px | Scrollbar chrome is decorative; chips remain scrollable. |

## Band story layout decision

Phone chip uses a stacked grid: full title and 331-character longest shipped story get the full row, then `Walk this story` and 44px dismiss controls use a second row. This keeps all copy in a bounded card under 30 percent of map height at 390px and 430px. A sheet would cover more map, add a second dismissal model, and compete with existing Layers and venue sheets. While venue list is open, chip pauses and returns when list closes; plan activation pauses while chip is visible.

## Carried-forward truncation inventory

Changed claim-bearing rules:

- `.dealsTonightDetail`: deal conditions can change offer meaning.
- `.cityStatusBannerCopy`: service limits and dates must remain visible.
- `.cityStatusBannerMobileCopy`: redundant ellipsis removed from short summary.
- `.citySuggestBannerCopy`: location-switch condition must remain visible.
- `.mapToolbarSearchStatusCopy`: recovery state and limitation must remain visible.
- `.mapSearchSuggestPrice > span`: drink and price claim must remain complete.
- `.mapSearchSuggestPriceProvenance`: source and observation date qualify price.
- `.mapVenueListCompactPrice > span`: drink and price claim must remain complete.
- `.mapVenueListPriceProvenance`: source and observation date qualify price.
- `.tonightLaneCollapsedChecked`: date and source scope qualify freshness.
- `.tonightLaneCardTitle`: listing conditions can limit headline claim.
- `.tonightLaneCardSource`: source and checked date qualify listing.
- `.bandOnboardingChip span`: story conditions must reach closing qualifier.
- `truncateBandCopy`: character truncation cut qualifiers before CSS layout.

Rules deliberately left bounded:

- Story and heritage prose: shared `.proseDisclosureText` remains a two-line closed preview on map hero, historic, borough, and quiet-pint cards. Show more removes the clamp from the same complete text node, so no cue list or copied qualifier fragment can drift from source prose. Era and source metadata remain separate visible siblings.
- User-entered search identity: `.mapToolbarSearchQuery` is a separately bounded, ellipsised span while `No venues match` and `with your current filters` remain complete and wrapping.
- Receipt, message, feed, and poster previews: `.barTabTileNote`, `.conversationPreview`, `.feedSpillNote`, `app/p/[id] clampText`, and `app/historic/[slug] clampText` all open a full destination.
- Venue identities: `.nmnCardName`, `.profileDropVenue`, `.venueHoverBody strong`, `.venuePickerList strong`, `.tonightPub`, `.nightCard__now`, `.nightCard__nextLabel`, `.gardenTonightPubName`, `.presenceVenue`, `.feedVenueLinkHead`, `.feedSpillVenueLink`, `.nightCrawl__doneName`, `.nightCrawl__upcomingName`, `.tonightLaneCardPlace span`, `.areaSheetPubName`, `.mapVenueListItemName`, `.mapSearchSuggestRowName`, `.spillPreviewMeta`, `truncateStopName`, and `.planSummary__editStops strong`.
- Area identities: `.nmnCardBorough`, `.crawlCompactArea`, `.gardenTonightPubArea`, `.mobileMapAreaLabel`, and `.citySwitcherLabel`.
- Account identities: `.dropCard .dropHandle`, `.authName`, `.feedHandle`, `.feedSpillHandle`, and `.spillPreviewHandle`.
- Titles and labels: `.bandOnboardingChip strong`, `.morningCard__title`, `.crawlCompactName`, `.nightCard__eyebrow`, `.planIntake__progress li > span:last-child`, `.pubsCardShelf li span`, `.feedSightingDrink`, `.mobileMapQueryChipText`, `.siteNavLink`, `.mobileTabLabel`, `.cmdkRowLabel`, and `.personaLensTriggerLabel`.
- Fixed actions: `.authSignIn`, `.authSignInLabelFull`, and `.authSignInLabelShort`.
- Editable composer source: `.spillPreviewNote` and `html[data-legacy="1"] .spillPreviewNote` retain full source outside their bounded preview.

No caption text was reworded.

## Wrapped-flow relationship audit

This pass checked offsets, margins, padding, top and bottom anchors, fixed and minimum heights, maximum heights and widths, flex bases, grid tracks, transforms, and absolutely or fixed-positioned siblings around every changed wrapping surface.

| Wrapped element | Hard dimension or positioned relationship checked | Outcome |
| --- | --- | --- |
| `.dealsTonightDetail` | Card has 44px minimum height, rem padding and gaps, but no height, absolute child, transform, or fixed grid track. | Detail, source, and action remain normal-flow flex-column siblings; added lines grow the card. |
| `.citySuggestBannerCopy` | Banner top uses toolbar height plus 12px; status stack starts at toolbar height plus 82px. Banner width caps at 420px, actions are 44px minimum, padding is 8px, and translateX only centres the whole banner. | Desktop shipped copy fits within the 70px inter-anchor lane. Component is unmounted on phone, so its mobile 112px rule is not claimed as rendered coverage. |
| `.cityStatusBannerCopy` | Stack has fixed top anchor, 460px width cap, 8px gap, viewport-derived max height, and translateX centring. Sheet has 360px width cap, 420px max height, `flex-basis: auto`, and a temporary 6px entrance translateY. | Banner and sheet share normal flex flow. Short sheets hug content; long sheets shrink and scroll; no fixed 46px clearance remains. Geometry assertions wait for the entrance transform to finish. |
| `.mapToolbarSearchStatusCopy` | Status has 52px minimum height and 8px gap; toolbar dependants use the 181px resting-height token. Recovery action is 44px minimum, and toolbar translateX only centres the whole block. | User query alone is capped at 20ch and 45 percent. Fixed prefix, limitation, and recovery copy wrap inside available status space without allowing user content to expand the dependent banner lane. |
| `.mapSearchSuggestPrice > span` and provenance | Row has 44px minimum height, 10px gap, 6px by 14px padding, and price width capped at 180px. | Minimum height can grow. Flex metadata stays in flow and venue identity owns the remaining width; no absolute sibling or fixed height assumes one line. |
| `.mapVenueListCompactPrice > span` and provenance | Row has 44px minimum height, 8px by 10px padding, 10px gap, and desktop price cap of 160px. Phone rule changes row to a content-sized column with 4px gap. | Price and provenance grow the row. No fixed track or positioned sibling depends on their former single-line height. |
| `.tonightLaneCollapsedChecked` | Absolute lane top is toolbar clearance plus 60px; pill has 360px width cap, 44px minimum height, hidden border overflow, and no fixed height. Main action has 44px minimum height and 15px side padding. | Wrapped freshness grows pill and stays within border. Collapsed form is desktop-only and is not counted as phone coverage. |
| `.tonightLaneChecked` | Open float has bottom anchor, 760px width cap, 520px or 62vh max height, 14px padding, and translateX. Sheet variant clears all positioning, transform, viewport width, and max-height rules. | Header grows in normal flow; map float remains bounded by its scroll area, while phone sheet uses parent scrolling. |
| `.tonightLaneCardTitle` and `.tonightLaneCardSource` | Cards have fixed 208px width, 10px by 12px padding, normal flex-column height, and a following 44px minimum action with 8px top margin. | Title, conditions, and source wrap vertically. Fixed card width does not imply fixed height; horizontal and vertical scroll containers absorb growth. |
| `.bandOnboardingChip span` | Desktop chip uses bottom 82px, 560px width cap, and translateX. Phone uses bottom lane token, two grid tracks `minmax(0, 1fr) 44px`, 8px gap, 10px padding, and 44px actions. Sheet-state hiding translates the whole chip 8px while removing pointer events. | Story owns a full content-sized first row; actions own second row. Real 390px and 430px geometry keeps chip within map, above navigation, and below 30 percent of map height. |
| Shared `.proseDisclosure` | Native summary has a 44px minimum height, content-sized grid rows, no fixed height, no absolute child, and no transform. Closed text has a two-line clamp; `[open]` switches the same node to block flow with visible overflow and no clamp. | Full prose remains in HTML in both states. Show more expands content-derived height, and Show less restores the short preview without semantic inference or copied text. |
| `.mapHeroCopy .proseDisclosure` | Desktop teaser uses left 18px, bottom `18px + 96px`, 300px width cap, 13px by 15px padding, a 24px dismiss control, and a temporary 6px entrance translateY. Phone hides the entire teaser. | Closed preview stays two lines. Opening grows the card upward from its bottom anchor; source stays in the header, and planning, route, or detail chrome hides the card before sharing its region. |
| `.historicHook .proseDisclosure` | Cards use content-sized flex columns, 8px gap, 16px padding, responsive equal-width grid tracks without fixed height, and a temporary entrance translateY on the whole card. | Closed preview cannot cover metadata. Opening expands in normal flow, so provenance remains below the full text at 390px and 430px. |
| `.boroughHeritageHook .proseDisclosure` | Cards are content-sized grid children; the map action has a 44px minimum height and `margin-top: auto`. | Opening expands the card before auto margin positions the action. Full `since 1583` text and following action do not overlap at 390px or 430px. |
| `.quietPintHeritage .proseDisclosure` | Venue link has a 44px minimum height and 12px by 14px padding. Disclosure is a separate sibling with 14px inline padding; foot uses wrapping flex layout with 6px by 10px gap and 12px bottom padding. | Native summary is not nested in the venue link. Opening grows the content-derived row; era, quiet condition, and source remain following normal-flow siblings. |
| `.venueOverviewMore` | Existing owner retains 12px block margins, border flow, a 44px summary, auto-positioned plus/minus marker, and 14px body padding. | Extraction changes ownership only. Optional venue details still expand in normal flow within the sheet scroll area. |

## Contrast evidence carried forward

`e2e/dark-primary-surfaces.spec.ts` calculates composited ratios from computed paint on production-route elements and their real ancestor surfaces. It covers landing primary and placeholder states, map active and disabled chips, and an opened venue sheet's active tab, primary action, price plaque, focus outline, and hover tab. Text must clear 4.5:1 and focus outline 3:1. Exact corrected figures appear in Evidence correction and in per-viewport test attachments.

After the real Add price action, the keyless signed-out production route renders `.venuePriceSignInGate`, not `.vpsubInput` or `.vpsubLog`; the test asserts that boundary. No ratio from those unmounted controls is presented as rendered evidence. Any isolated control check would be fixture-only.

Disabled controls are exempt from WCAG text-contrast success criteria because they are inactive user-interface components. PUBMAXX still holds them to the same 4.5:1 test floor so state is understandable before interaction and disabled actions do not look missing; cursor, opacity, and disabled semantics remain additional state cues.
