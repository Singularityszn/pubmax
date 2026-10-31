# Phone mockups and contrast sweep, 30 October 2026

This folder answers section 5 of [the launch UX record](../2026-10-30-launch-ux-variations.md). It holds three phone mockups, one for each direction, and a measured contrast sweep of the CSS that rounds 1 to 3 added.

Nothing here changes the product except one token swap in `components/compass/pintCompass.css`, described below.

## The mockups

Each file is one self-contained HTML page, 390 px wide, with no external font or script. The launch tokens are copied in by name from `app/globals.css` and `app/theme.css`, so a value can be diffed against the product. Light and dark follow `prefers-color-scheme`. Each page shows the same four screens at 390 by 844: the venue sheet, Tonight, the locked plan and the profile. A dashed blue outline and a "Proposed" tag mark what does not exist yet. Prices, times and handles are illustrative, and each page says so.

| File | Direction | What it shows |
| --- | --- | --- |
| [`v1-answer-card.html`](./v1-answer-card.html) | V1. The answer card | The sheet with five folds and only Price open, Tonight with three answers above the rows, the plan as one card, and the passport cover on the profile. |
| [`v2-night-table.html`](./v2-night-table.html) | V2. The night table | A face row in the sheet head ("Sam paid £5.80 here on Friday"), open plans first on Tonight, faces and 64 px night mode taps on the plan, and "your lot" first on the profile. |
| [`v3-field-guide.html`](./v3-field-guide.html) | V3. The field guide | Been, Pubs to try and Rank it as a bar at the foot of the sheet with Share in the overflow, "Try one of these" on Tonight, "Keep these four as a list" on the plan, and the passport book in sections with the pairwise rank card. |

Screenshots, taken with Playwright at 390 by 844, full page: `v1-answer-card-light.png`, `v1-answer-card-dark.png`, `v2-night-table-light.png`, `v2-night-table-dark.png`, `v3-field-guide-light.png`, `v3-field-guide-dark.png`.

### What is real today

Rounds 1 to 3 shipped these, and the mockups draw them as the product draws them:

- The five-fold venue sheet: Price, Tonight, Getting there and home, The pub, Your record. Only Price is open on arrival (`components/map/inspector/OverviewFold.tsx`, `lib/venueOverviewFolds.ts`).
- The Tonight answer cards: Cheapest near you, On tonight, Last train, and open plans above the fold (`components/tonight/TonightAnswerCards.tsx`).
- The plan as one card: the cover, the start in words, the crew handles, Send to the crew, Who's in and Night mode (`components/plan/PlanCard.tsx`).
- The passport on the profile: the cover figures and the sections under it (`components/profile/PassportCover.tsx`, `components/profile/PassportSections.tsx`).
- The rank card after a visit exists (`components/pubs/rankAfterVisit.css`); V3 proposes where it sits on the profile.

### What is proposed

- V1: tab names that match their contents (Overview, Prices, Lore, Photos, Menu). The rest of V1 is shipped.
- V2: faces in the sheet head and on the plan card, the night mode taps, "your lot" first on the profile. Faces are initials on a neutral disc until the captain decides on photographs on public surfaces.
- V3: the list bar at the foot of the sheet, "Try one of these" on Tonight, "Keep these four as a list", and the passport book sections.

Each screen spends coral once: the one primary. The create disc is not drawn.

## Micro-fix 11: the grey "Unknown" on the peek

The record says the peek row's grey text under a drink lens reads below AA on Night Out ink, and suggests `--color-text-muted` on `--panel-raised`. Measured, it does not reproduce, so no CSS changed.

- The peek card (`components/mobile/mobileMapShell.css`) already paints its quiet line (`.mapPeekHush`) and its eyebrow in `--color-text-muted` on `--color-surface-raised`, which is `--panel-raised`. That is 5.59:1 in light and 5.80:1 in dark.
- Under a lens the finding ("No whisky price logged") prints in the list the peek opens, `.mapVenueListItemMeta` in `--muted` on the list panel. That is 5.16:1 in light and 5.43:1 in dark. `--muted` and `--color-text-muted` are the same value in both themes, so a swap changes nothing.
- No string "Unknown" is drawn on the peek. The launch review used the word for 312 venues whose wine price is not painted on the pins (B2, House Wine Index). That is a data gap, not a contrast fault.

Before and after: 5.80:1 dark and 5.59:1 light for the peek line, unchanged.

## Contrast sweep

`node docs/design-explorations/2026-10-30-phone-mockups/contrast.mjs` prints this table. It reads the token values from `app/globals.css` and `app/theme.css` on every run, resolves `var()` and `color-mix()` the way a browser computes a custom property, and exits non-zero when a live pair is under its bar. Add `--hex` for the resolved colours. The bar is 4.5:1 for body text and 3:1 for large text. The venue sheet is translucent over the map; it is measured as `--sheet-material-solid`.

Two notes on what the script found while resolving:

- A token declared at `:root` is computed on `<html>`. So `--color-surface-raised` resolves to the html value of `--panel-raised` (`#fffdf9` in light), while a rule that reads `--panel-raised` directly gets the body remap (`#fdf9f4`). Both pass; the two values are 0.5 apart in ratio.
- Rows marked BEFORE are the pair a fix replaced. They are shown and never counted.

| File | Rule | Text on surface | Light | Dark | Bar | Result |
| --- | --- | --- | --- | --- | --- | --- |
| mobileMapShell.css | .mapPeekHush (lens quiet line) | --color-text-muted on --color-surface-raised | 5.59 | 5.80 | 4.5:1 | pass |
| mobileMapShell.css | .mapPeekEyebrow | --color-text-muted on --color-surface-raised | 5.59 | 5.80 | 4.5:1 | pass |
| mapVenueList.css | .mapVenueListItemMeta (lens finding) BEFORE | --muted on color-mix(in srgb, --surface-tint-river 30%, --panel-raised) | 5.16 | 5.43 | 4.5:1 | pass |
| mapVenueList.css | .mapVenueListItemMeta (lens finding) | --color-text-muted on color-mix(in srgb, --surface-tint-river 30%, --panel-raised) | 5.16 | 5.43 | 4.5:1 | pass |
| mapVenueList.css | .mapVenueListPriceProvenance | --muted on color-mix(in srgb, --surface-tint-river 30%, --panel-raised) | 5.16 | 5.43 | 4.5:1 | pass |
| cityPubsOnlyNote.css | .cityPubsOnlyNote | --ink on --panel-raised | 17.07 | 14.46 | 4.5:1 | pass |
| rankAfterVisit.css | .rankAfterVisit | --ink on --panel-raised | 17.07 | 14.46 | 4.5:1 | pass |
| rankAfterVisit.css | .rankAfterVisit__notice | --ink-soft on --panel-raised | 9.96 | 9.84 | 4.5:1 | pass |
| rankAfterVisit.css | .rankAfterVisit__pair button | --ink on --panel | 14.59 | 16.39 | 4.5:1 | pass |
| rankAfterVisit.css | .rankAfterVisit__pair span | --ink-soft on --panel | 8.52 | 11.15 | 4.5:1 | pass |
| rankAfterVisit.css | .rankAfterVisit__quiet | --river on --panel-raised | 5.13 | 6.30 | 4.5:1 | pass |
| rankAfterVisit.css | .rankAfterVisit__lot small | --ink-soft on --panel-raised | 9.96 | 9.84 | 4.5:1 | pass |
| withTagField.css | .withTagHint, .withTagMatches p | --muted on --sheet-material-solid | 5.68 | 5.03 | 4.5:1 | pass |
| withTagField.css | .withTagMatch | --ink on --panel | 14.59 | 16.39 | 4.5:1 | pass |
| withTagField.css | .withTagMatch span | --muted on --panel | 4.63 | 6.57 | 4.5:1 | pass |
| passportBook.css | dt, .passportQuiet, .passportRowMeta, .passportPlace, .passportFactDate | --color-text-muted on --paper | 5.11 | 7.07 | 4.5:1 | pass |
| passportBook.css | dd, .passportRowName, .passportSectionTitle, .passportTopTenName | --color-text on --paper | 16.10 | 17.62 | 4.5:1 | pass |
| passportBook.css | .passportBandPlaque (cheap) | --price-band-ink on --price-band-surface | 5.18 | 5.76 | 4.5:1 | pass |
| passportBook.css | .passportBandPlaque (average) | --price-band-ink on --price-band-surface | 5.66 | 6.37 | 4.5:1 | pass |
| passportBook.css | .passportBandPlaque (expensive) | --price-band-ink on --price-band-surface | 5.51 | 5.09 | 4.5:1 | pass |
| tonightAnswers.css | .tonightAnswerTitle, .tonightAnswerMeta, .tonightAnswerSource | --color-text-muted on --paper | 5.11 | 7.07 | 4.5:1 | pass |
| tonightAnswers.css | .tonightAnswerLead, .tonightRegularTitle, .tonightPlanCardAsk | --ink on --paper | 16.10 | 17.62 | 4.5:1 | pass |
| addRegularNight.css | .addRegularNightField, .addRegularNightLine | --muted on --paper | 5.11 | 7.07 | 4.5:1 | pass |
| addRegularNight.css | .addRegularNightField select | --ink on --panel-raised | 17.07 | 14.46 | 4.5:1 | pass |
| addRegularNight.css | .addRegularNightSend | --ink on --control-secondary-surface | 17.61 | 14.46 | 4.5:1 | pass |
| plan.css | .planCard__when | --color-text-muted on --panel-raised | 5.42 | 5.80 | 4.5:1 | pass |
| plan.css | .planCard__title (large) | --color-text on --panel-raised | 17.07 | 14.46 | 3:1 | pass |
| plan.css | .planCard__firstStop | --color-text on --paper | 16.10 | 17.62 | 4.5:1 | pass |
| plan.css | .planCard__handle | --badge-ink on --badge-surface | 9.11 | 8.36 | 4.5:1 | pass |
| venueSheet.css | .venueOverviewFoldLabel | --ink on --sheet-material-solid | 17.89 | 12.54 | 4.5:1 | pass |
| venueSheet.css | .venueOverviewFoldHint | --muted on --sheet-material-solid | 5.68 | 5.03 | 4.5:1 | pass |
| venueSheet.css | .venueOverviewFoldSummary::after (glyph, large) | --muted on --sheet-material-solid | 5.68 | 5.03 | 3:1 | pass |
| savedListCover.css | .savedListCover__caption | --ink on --paper | 16.10 | 17.62 | 4.5:1 | pass |
| diary.css | .diaryRatingLabel | --color-text on --sheet-material-solid | 17.89 | 12.54 | 4.5:1 | pass |
| diary.css | .diaryRatingValue, .diaryRatingClear, .diaryLotToggle small | --color-text-muted on --sheet-material-solid | 5.68 | 5.03 | 4.5:1 | pass |
| diary.css | .diaryPanel__empty | --color-text-muted on --paper | 5.11 | 7.07 | 4.5:1 | pass |
| diary.css | .diaryRow__venue, .diaryRow__review, .diaryRow__action | --color-text on --color-surface-raised | 17.61 | 14.46 | 4.5:1 | pass |
| diary.css | .diaryRow__date, .diaryRow__usual | --color-text-muted on --color-surface-raised | 5.59 | 5.80 | 4.5:1 | pass |
| diary.css | .diaryRow__action--primary (coral fill) | --color-on-accent on --brass | 5.96 | 6.64 | 4.5:1 | pass |
| diary.css | .diaryRow__error | --brick on --color-surface-raised | 5.81 | 5.34 | 4.5:1 | pass |
| diary.css | .diaryUsualInput | --color-text on --color-surface | 16.88 | 17.62 | 4.5:1 | pass |
| sunChaser.css | .sunChaserScrubber, .sunChaserStatus | --ink on --sheet-material-solid | 17.89 | 12.54 | 4.5:1 | pass |
| sunChaser.css | .sunChaserVenueLine | --ink-soft on --sheet-material-solid | 10.44 | 8.54 | 4.5:1 | pass |
| pintCompass.css | .pcExplainer, .pcNote, .pcWalkMeta, .pcCount | --color-text-soft on --paper | 9.40 | 12.00 | 4.5:1 | pass |
| pintCompass.css | .pcWalkLabel | --color-text-muted on --paper | 5.11 | 7.07 | 4.5:1 | pass |
| pintCompass.css | .pcDirection | --color-text on --panel-raised | 17.07 | 14.46 | 4.5:1 | pass |
| pintCompass.css | .pcDirectionAligned BEFORE (--color-positive) | --color-positive on --panel-raised | 2.95 | 6.41 | 4.5:1 | under |
| pintCompass.css | .pcDirectionAligned (--tint-ink-positive) | --tint-ink-positive on --panel-raised | 7.27 | 7.96 | 4.5:1 | pass |
| pintCompass.css | .pcWalkMeta (card) | --color-text-soft on --panel-raised | 9.96 | 9.84 | 4.5:1 | pass |
| pintCompass.css | .pcCaption (card) | --color-text-muted on --panel-raised | 5.42 | 5.80 | 4.5:1 | pass |

### Fixes

| Pair | Light | Dark | Fix |
| --- | --- | --- | --- |
| `.pcDirectionAligned` ("You are facing it." on the Pint compass card): `--color-positive` on `--panel-raised` | 2.95 | 6.41 | Now `--tint-ink-positive`, the green as a word: 7.27 light, 7.96 dark. The text is 1.16rem bold, under the 18.66 px bold line for large text, so the bar is 4.5:1. |

Every other pair in the ten files from rounds 1 to 3, and in the Sun Chaser stylesheet, passes in both themes. No coral was added, no new colour, no raw hex.

## Micro-fix 10: the create disc and the Pub Pal button

A captain decision. Nothing changed. Measured in Chromium at 390 by 844, keyboard closed, no safe-area inset, with the real `components/nav/navigation.css`, `palNav.css`, `mobileNav.css` and `createFab.css` on a page with no other floating member:

| Control | Left edge | Right edge | Bottom, from the screen foot | Top, from the screen foot |
| --- | --- | --- | --- | --- |
| Pub Pal face in the dock, 48 px | 141 px | 201 px from the right | 28 px | 76 px |
| Create disc, 56 px | 322 px | 12 px from the right | 83 px | 139 px |

They are not on the same edge. The Pal face is the third of six dock columns, left of centre. The disc sits on the right edge. There are 133 px between them across, and the disc's foot is 6 px above the face's top. At 360 px wide the gap across is 108 px. On the map the disc parks higher still, above the map-edge column, so the gap grows. A real phone with a home-indicator inset adds the same inset to both. The record asks for one check on a real phone; this is a browser measurement, not that check.
