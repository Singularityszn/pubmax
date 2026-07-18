# Map chrome tiers — target architecture + adoption notes

From the #352 systemic review: at full merge the 390px map was headed for seven
peer chips — instrument-panel, not answer. This branch implements the
three-tier hierarchy on main. `lib/mapChromeTiers.ts` is the single source of
truth; the shell renders its descriptors.

| Tier | Surface | Treatment |
|---|---|---|
| 1 | **Near me** | The only primary-weight chip (`.mobileMapChipPrimary`, filled accent) |
| 2 | **Tonight**, **Filters** | Quiet chips. Filters absorbs the old Drinks + price chips (both always opened the same sheet); refinement count renders as the chip badge |
| 3 | **TfL** (+ **List**) | Compact 44px icon-buttons in `.mobileMapUtilityCorner` (fixed, right edge, badge-capable) |

The Tonight lane, plan pill, and tab bar are unchanged — they are lanes/docks,
not chips, and sit outside this hierarchy.

## Adoption notes for in-flight branches (mechanical rebases)

- **#309 near-me sheet** (`feat/instant-answer`): its Near-me chip behavior
  replaces `onNearMe`'s recenter-only success with the answer sheet — keep the
  Tier-1 chip mount exactly as here (`.mobileMapChipPrimary`), wire its sheet
  open into the existing `onNearMe` callback. No new chip.
- **#329 zone lens** (`feat/zone-price-lens`): do NOT mount the Zone chip on
  mobile. The zone picker already renders inside the mobile filters sheet on
  that branch — that becomes its only mobile home. Add `zoneActive` as a third
  refinement input to `buildFiltersChip` (one-line: extend the input type and
  the count/aria parts). Desktop toolbar chip unchanged.
- **#346 list view** (`fix/a11y-findings`): mount the List toggle as the second
  icon-button inside `.mobileMapUtilityCorner` (after TfL), reusing its
  existing handler; drop its standalone placement. Add an entry to
  `buildTflCorner`'s pattern if it needs a model (it's stateless — a plain
  IconButton is fine).

## Props change (shell)

`MobileMapShell` now takes `drinkFiltersActive` + `priceCapActive` instead of
the combined `filtersActive`; `priceLabel` stays (feeds the Filters aria label
and the sheet). `PubMap.tsx:1611` splits its existing boolean — no logic change.
