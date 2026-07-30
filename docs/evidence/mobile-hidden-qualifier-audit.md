# Mobile hidden qualifier audit

Reviewed 30 July 2026.

Rerun the broad source sweep with:

```bash
rg -n -C 8 'display:\s*none|visibility:\s*hidden' app components --glob '*.css'
```

For each result, inspect its enclosing media query. The inventory below includes every result inside a `max-width`, `hover: none`, or `pointer: coarse` mobile rule. It excludes base rules and minimum-width-only desktop rules.

This source sweep is supplementary discovery only. CSS enumeration cannot prove that a component is mounted, that its text reaches the rendered page, or that an ancestor leaves it visible. Acceptance uses rendered production pages at 390px and 430px.

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
| `components/map/cityStatusBanner.css` `.cityStatusBannerCopy` | `PubMap` mounts `CityStatusBanner` only when `!mobileViewport`. | Not mounted on mobile and not fixed here. Phone service-status presentation remains a separate product decision. |
| `components/map/cityStatusBanner.css` `.cityStatusBannerDismiss` | Same desktop-only `CityStatusBanner` boundary. | Not mounted on mobile and not fixed here. |
| `components/map/citySuggestBanner.css` `.citySuggestBannerCopy` | `PubMap` mounts `CitySuggestBanner` only when `!mobileViewport`. | Not mounted on mobile and not fixed here. Phone city-suggestion presentation remains a separate product decision. |

## Rendered acceptance

`e2e/price-caption-integrity.spec.ts` exercises production routes rather than isolated CSS fixtures:

- `/map/glasgow?band=subcrawl` at 390px and 430px renders the exact 331-character story, expands the live MapLibre attribution control, and finds the exact `Pub data © OpenStreetMap contributors (ODbL)` credit above phone navigation.
- Native `/onboarding` at 390px and 430px renders all three exact `PUBMAXX reviewed` source labels, then all six exact companion notes.
- `/pal` at 390px and 430px renders exact setup progress from the live onboarding state.

City status and city suggestion have no mobile rendered-output assertion because those components are not mounted there and are explicitly outside this remediation.

Focused verification:

```bash
npx playwright test e2e/price-caption-integrity.spec.ts --project=chromium
```

Result: 45 passed.

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
- `.mapHeroCard p`: factual story text can carry dates and scope.
- `.bandOnboardingChip span`: story conditions must reach closing qualifier.
- `truncateBandCopy`: character truncation cut qualifiers before CSS layout.
- `.historicHook`: cited history can carry dates and uncertainty.
- `.boroughHeritageHook`: cited history can carry dates and uncertainty.
- `.quietPintHeritage`: cited history can carry dates and current-day limits.

Rules deliberately left bounded:

- Receipt, message, feed, and poster previews: `.barTabTileNote`, `.conversationPreview`, `.feedSpillNote`, `app/p/[id] clampText`, and `app/historic/[slug] clampText` all open a full destination.
- Venue identities: `.nmnCardName`, `.profileDropVenue`, `.venueHoverBody strong`, `.venuePickerList strong`, `.tonightPub`, `.nightCard__now`, `.nightCard__nextLabel`, `.gardenTonightPubName`, `.presenceVenue`, `.feedVenueLinkHead`, `.feedSpillVenueLink`, `.nightCrawl__doneName`, `.nightCrawl__upcomingName`, `.tonightLaneCardPlace span`, `.areaSheetPubName`, `.mapVenueListItemName`, `.mapSearchSuggestRowName`, `.spillPreviewMeta`, `truncateStopName`, and `.planSummary__editStops strong`.
- Area identities: `.nmnCardBorough`, `.crawlCompactArea`, `.gardenTonightPubArea`, `.mobileMapAreaLabel`, and `.citySwitcherLabel`.
- Account identities: `.dropCard .dropHandle`, `.authName`, `.feedHandle`, `.feedSpillHandle`, and `.spillPreviewHandle`.
- Titles and labels: `.bandOnboardingChip strong`, `.morningCard__title`, `.crawlCompactName`, `.nightCard__eyebrow`, `.planIntake__progress li > span:last-child`, `.pubsCardShelf li span`, `.feedSightingDrink`, `.mobileMapQueryChipText`, `.siteNavLink`, `.mobileTabLabel`, `.cmdkRowLabel`, and `.personaLensTriggerLabel`.
- Fixed actions: `.authSignIn`, `.authSignInLabelFull`, and `.authSignInLabelShort`.
- Editable composer source: `.spillPreviewNote` and `html[data-legacy="1"] .spillPreviewNote` retain full source outside their bounded preview.

No caption text was reworded.

## Contrast evidence carried forward

Composited rendered measurements from shipped dark elements and their parent surfaces:

- Placeholder and disabled-control text on raised surfaces: 5.80:1.
- Dark text on coral primary controls: 6.64:1.
- Price plaque text: 6.30:1.
- Coral focus outline against raised sheet: 5.32:1.
- Each two-tone pin edge against every tested dark basemap tone: at least 3:1.

Disabled controls are exempt from WCAG text-contrast success criteria because they are inactive user-interface components. PUBMAXX still keeps them at 5.80:1 so state is understandable before interaction and disabled actions do not look missing; cursor, opacity, and disabled semantics remain additional state cues.
