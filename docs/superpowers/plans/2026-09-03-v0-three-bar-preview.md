# v0 three-bar preview (Tonight / Drinks / phone nav)

> **For Composer 2.5:** Execute the locked bars in order on a **preview** branch. Do not merge to `main`. Do not change production env or billing. Do not rebase or merge closed PR #1237. Do not implement Pal, Social, or WebMCP #1318. This document is the whole brief: no further product-code from the planner.

**Goal:** On a Vercel preview (not live), three bars become true for a logged-out London session:

1. Tonight’s primary is a real independent-pub listing **or** the existing honest empty sentence. J D Wetherspoon weekly deals and Ticketmaster events must not be the lede.
2. A public `GET /api/pint-drops` drop for Hatton (`venue-1vle947`, Lager £4.50) renders on that venue’s **Drinks** tab. The empty sentence “We don’t have this pub’s drinks yet.” must not win when the drop is visible.
3. Phone landing Map / Plan / Tonight are tappable (≥44×44). Map opens `/map`. Tonight is reachable on a phone before 17:00 London. Desktop landing Map must not send a stranger to `/choose-city`.

**If cheap after those three:** freshness honesty so `/today` does not present `3 July 2026` as the current listed-price clock. PR **#1321 is already merged** on current `main` (`1a6656323`). Do **not** re-merge it. Verify on a preview of current `main`, then add the small `/today` caption follow-up only if the July stamp still reads as current.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright.

---

## Do not

- Merge to `main`, promote the preview, or touch production env / GitHub Actions billing.
- Rebase or merge closed PR **#1237**.
- Expand Pal, Social, or WebMCP (**#1318** is already on `main`; leave it alone).
- Invent `GET /api/tonight`. Live `/api/tonight` 404 is expected. Tonight is HTML plus `/api/whats-on` and `/api/out`.
- Add a sixth phone dock tab.
- Change `nowTabHref`’s 17:00 London flip without a captain call.
- Promote a pint-drop into pin colour, cheapest buckets, or `mergeCommunityPriceSignals`. Sheet visibility is not map authority.
- Title-match “Curry Club” as the JDW rule. Identify the chain by source / harvest / deal id.
- Invent a new pint-dataset collection date. Keep the dated stamp; change the framing.
- Lower the `pint_prices` registry `stalenessBudgetHours` (2160h). That is the neglect / CI gate, not the drinker caption.

---

## Live vs current main

| What | SHA / ref | Note |
|--|--|--|
| Live production (3 Sep 2026 battle test) | `ed7f570ad` / **#1328** / `dpl_5U3gT9kYva3hEdZ25kA3a4qXpyHF` | The three bars failed here. |
| Branch-from at plan time | `origin/main` tip (then `23f8239fa`, #1331) | Eight commits ahead of live. |
| Freshness PR #1321 | Merged as `1a6656323` **after** live | Closed 2026-09-03 ~11:33 UTC. Not on the `ed7f570` checkout. |
| WebMCP #1318 | On current `main` | Out of scope. Do not expand. |

At execution time: `git fetch origin main` and branch from **current** `origin/main`. Do not rewind to `ed7f570`. Do not include #1318 work in the preview PR.

Battle-test evidence (logged-out, ~11:35–11:52 BST, 3 Sep 2026):

- `/tonight` HTML 200; `/api/whats-on` 144 rows (96 JDW + 48 Ticketmaster); `/api/out` 64 TM, `openPlans []`.
- One visible public pint-drop (Hatton Lager £4.50). Drinks tab empty.
- Landing header Map / Plan / Tonight 0×0 on phone; dock has Now, not Tonight. Desktop landing Map → `/choose-city`.
- `/today` sidebar: “Lowest listed prices in central London, as of 3 July 2026.”
- Map `uk_base` pack `51.25_-0.25.json` 500 and “Map background couldn't load” are **context only**, not a locked bar.

Shots: `battle-test-2026-09-03-mid/shots/05-desktop-tonight.png`, `04-desktop-drinks.png`, `11-mobile-home.png`, `06-desktop-today.png`.

Hunches (verified in source, treat as fact now):

- Tonight UI reads What’s-On + Out, not a `/api/tonight`.
- Pint-drops are not wired into the Drinks tab. Stories (`pints`) already mounts `PintDropsList`.
- Landing header `.lpPrimaryNav` is `display: none` at `max-width: 960px`.

---

## Architecture (what already exists)

```
/tonight  → TonightClient
              useWhatsOnTonight  → GET /api/whats-on
              useOutListings     → GET /api/out
              mergeTonightListingRows (pubOnly=true)  → listed-venue rows only
              orderDealsInPlace / digestSectionPicks  → first card + “Same deal at 96 pubs”

/today    → todayListings.server mergeTodayListingRows (pubOnly=false)
              digestSectionPicks → “Top picks for tonight”

Drinks tab = venueInspectorTabs key "menu"
              VenueMenuTab → venueMenuForInspector → venueDrinkMenu(venue.prices)
              MenuCategoryGrid empty: “We don’t have this {noun}’s drinks yet.”
              usePintDrops already loaded on VenueInspector; passed to VenuePintsTab only

Landing chrome ≠ SiteNav
              SiteNav Map is already /map (PRIMARY_NAV_ITEMS)
              Landing Map href = preferredCity ? preferredCityMapHref() : "/choose-city"
              Dock = Now · Map · Out · Social · You
              nowTabHref = /today before 17:00 London, /tonight after
```

“Has a `venueId`” is **not** “real pub as lede.” JDW Curry Club at Goldengrove / Coombe Lodge survives `tonightRowHasListedPub`. A Ticketmaster row that matched a listed pub survives too. Unmatched TM theatre/arena is already dropped on Tonight (`pubOnly=true`). Today’s picks still use `pubOnly=false`.

---

### Task 1: Tonight primary predicate (Bar 1)

**Files:**

- Add: `lib/tonightPrimary.ts` (pure; keep `lib/tonightOutListings.ts` as the merge owner)
- Modify: `lib/tonightOutListings.ts` only if the merge needs a `primaryOnly` argument. Prefer filtering **after** merge at the presentation seam.
- Modify: `app/tonight/TonightClient.tsx` (list fed to `groupTonightListings` / `orderDealsInPlace`)
- Modify: `app/tonight/TonightOnTonightSummary.tsx` (counts / named rows must follow the same predicate)
- Modify: `lib/todayListings.server.ts` (`mergeTodayListingRows` must stop using `pubOnly = false` for the picks card)
- Modify: `app/today/page.tsx` / `app/today/TodayClient.tsx` so “Top picks for tonight” uses the same primary set
- Read, do not rewrite: `lib/dealsHonesty.ts`, `lib/tonightListGrouping.ts`, `lib/dealsDigest.ts`, `lib/harvest/sourcePolicy.ts` (`wetherspoon-food-drink`, `kind: "chain-deals"`)
- Test: `__tests__/tonightOutListings.test.ts` (add primary cases; do not weaken existing pub-surface tests)
- Test: new `__tests__/tonightPrimary.test.ts`
- Test: `__tests__/dealsHonesty.test.ts`, `__tests__/frictionVoice.test.ts` if copy moves
- E2E: `e2e/tonight.spec.ts` (first card / empty lead)

**Step 1: Write the failing predicate tests first**

Export one predicate, e.g. `isTonightPrimaryListing(row: WhatsOnRow): boolean`, plus `tonightPrimaryRows(rows)`.

A row is **not** primary when any of these hold:

- `source.url` host is `jdwetherspoon.com` (harvest `wetherspoon-food-drink`).
- Deal id starts `deal-jdw-`.
- Harvest / source identity is `kind: "chain-deals"` if that field is on the row; if it is not on the wire, do not invent it — use host + id.
- `kind === "event"` (Out / Ticketmaster live lane).
- Source label or URL names Ticketmaster.

A row **is** primary when it is a listed-pub What’s-On quiz, live music, or independent deal that is none of the above.

Do **not** match titles such as “Curry Club”. Do **not** drop the What’s-On or Out feeds. Secondary lanes (`DealsTonightLane`, `MusicTonightLane`) may still list chain deals **below** the primary list. If the primary list is empty, the first thing a reader sees must be `tonightEmptyLead` / `TONIGHT_QUIET_NIGHT_SENTENCE` (“The city’s having a quiet one tonight…”), not Curry Club above the fold.

**Step 2: Confirm RED**

Run:

```
npx vitest run __tests__/tonightPrimary.test.ts
```

Expected: RED because the helper does not exist.

**Step 3: Implement the helper and apply it at the presentation seams**

In `TonightClient`, filter `listingRows` (or the input to `groupTonightListings`) through `tonightPrimaryRows` **before** `orderDealsInPlace`. `digestSectionPicks` grouping “Same deal at 96 pubs” must not be able to put a JDW digest in the primary slot.

In `TonightOnTonightSummary`, counts and named examples (“Curry Club®…”, “Lily Seabird”) must come from the primary set. A quiet primary night with leftover JDW in a secondary lane still reads as a quiet night in the summary.

In `mergeTodayListingRows`, pass `pubOnly = true` (same as Tonight) **and** apply `tonightPrimaryRows` before `digestSectionPicks`. Today must not lede with unmatched TM or JDW.

**Step 4: Confirm GREEN**

```
npx vitest run __tests__/tonightPrimary.test.ts __tests__/tonightOutListings.test.ts __tests__/dealsHonesty.test.ts
```

Add a Tonight fixture whose only surviving pub-surface rows are JDW + TM: status becomes `empty` for the **primary** list and the lead is `tonightEmptyLead`, not a deal card.

Voice: no em dash, no “please try again”, British spelling. Empty copy already exists; reuse it.

---

### Task 2: Public pint-drop on the Drinks tab (Bar 2)

**Files:**

- Modify: `lib/drinkMenu.ts` **or** add `lib/pintDropDrinks.ts` (prefer a sibling so `venueDrinkMenu` stays “legacy prices + seeds” as its comment states)
- Modify: `lib/venueMenu.ts` (`venueMenuForInspector`) **or** compose in the tab
- Modify: `components/map/inspector/VenueMenuTab.tsx`
- Modify: `components/map/VenueInspector.tsx` (pass already-loaded `drops` / `pintDrops` into `VenueMenuTab`; do **not** add a second `GET /api/pint-drops`)
- Read: `components/map/usePintDrops.ts`, `lib/pintDropShared.ts`, `lib/pintDropsStore.ts`, `lib/drinkCategoryFromText.ts`, `lib/drinks.ts`, `lib/menuHub.ts`
- Read: `components/drinks/MenuCategoryGrid.tsx` (owns the empty sentence), `components/drinks/DrinkMenu.tsx`
- Test: `__tests__/menuEmptyState.test.ts`, `__tests__/drinkMenu.test.ts`, `__tests__/pintDrops.test.ts`
- Add: `__tests__/pintDropDrinks.test.ts` (Hatton-shaped drop → Drink row; empty sentence does not win)

**Step 1: Failing unit test**

Given venue `venue-1vle947` with empty `venue.prices` and one visible public drop `{ drink: "Lager", priceGbp: 4.5, venueId: "venue-1vle947" }`:

- `menuHubTiles` / the Drinks hub has a drink tile (not food-only).
- Rendered Drinks copy includes `Lager` and `£4.50` (use `formatGbp`).
- Rendered copy does **not** include `We don’t have this pub’s drinks yet.`

Also pin:

- `priceGbp: null` → no invented figure; drop may appear as a nameless observation or be omitted from the priced menu. Do not print `£0`.
- Unclassifiable `drink` text → `drinkCategoryFromText` returns `null`; do not invent a category. Prefer `other` only if the taxonomy already allows an honest fallback; otherwise omit from category tiles and still skip the empty sentence if the drop is shown as a named row.
- Hidden / friends-only drops do not appear on a logged-out sheet. Use `visibilityOf` / the same public filter `usePintDrops` already applies.

**Step 2: Confirm RED**

```
npx vitest run __tests__/pintDropDrinks.test.ts __tests__/menuEmptyState.test.ts
```

Expected: RED. `venueDrinkMenu` explicitly does not touch the pint-drop store (`lib/drinkMenu.ts` header comment). `VenueInspector` passes drops to `VenuePintsTab` only.

**Step 3: Project visible public drops into the Drinks list**

Map a drop → `Drink`:

- `name` = drop `drink`
- `priceGbp` = drop `priceGbp` only when it is a finite number
- `category` = `drinkCategoryFromText(drink)` when confident (“Lager” → beer)
- `provenance.source` = `"Pint Drop"` (or the drop handle if the public DTO already names one). `lane` must **not** be `"dataset"` or `"demo"`.
- `id` stable from drop id so a re-render does not duplicate

Compose: `venueMenuForInspector(venue, updates)` **plus** projected drops. Dedupe by name+price so a drop that already matches a curated pint does not double.

`MenuCategoryGrid` empty state fires when there are no drink tiles. Filling `menuDrinks` is enough; do not special-case the sentence in the grid.

**Step 4: Confirm GREEN**

```
npx vitest run __tests__/pintDropDrinks.test.ts __tests__/menuEmptyState.test.ts __tests__/drinkMenu.test.ts __tests__/pintDrops.test.ts
```

Do not call `mergeCommunityPriceSignals` from this path. A single uncorroborated drop may paint the sheet and must not recolour the pin.

---

### Task 3: Tappable landing nav (Bar 3)

**Files:**

- Modify: `components/landing/LandingPage.tsx`
- Modify: `components/landing/landing.css` (the `max-width: 960px` rule that sets `.lpPrimaryNav { display: none }`)
- Read, do not change dock model: `components/nav/navigationModel.ts` (`PRIMARY_NAV_ITEMS`), `components/nav/NowSegment.tsx`, `lib/londonHour.ts` (`NOW_TAB_FLIP_HOUR = 17`)
- Test: `__tests__/landingFindMyPintHierarchy.test.ts` (mocks `preferredCityMapHref: () => "/choose-city"` today)
- E2E: `e2e/landing-find-my-pint.spec.ts` **pins Map → `/choose-city` today** (lines ~62 and ~78). Update both.
- E2E: `e2e/mobile-landing-entry.spec.ts` (`expectTappable` already exists). Extend to Map, Plan, Tonight at 390×844.
- Sweep: `e2e/smoke.spec.ts` and any landing unit test that asserts `/choose-city` for Map.

**Step 1: Failing e2e / unit assertions**

Locked hrefs:

- Landing header **Map** → `/map` (not `/choose-city`).
- Hero “Open the map” → `/map`.
- City chooser stays an explicit “Pick your city” link (`/choose-city` already in the landing footer). `preferredCityMapHref()` may still deep-link a remembered city; a stranger with no preference must get `/map`.

Phone Tonight:

- Do **not** add a sixth dock item.
- Either un-hide a compact Map | Plan | Tonight subset of `.lpPrimaryNav` at ≤960px with 44px taps, **or** add a Tonight text link to `.lpHeroSecondaryRow` (already visible on phone as a column). Prefer the hero-secondary Tonight link if the full header row overflows 390px.
- Plan in the hidden header is why Plan is 0×0. The hero “Plan tonight together” link must also stay ≥44×44 (`e2e/mobile-landing-entry.spec.ts`).

**Step 2: Confirm RED**

```
npx vitest run __tests__/landingFindMyPintHierarchy.test.ts
npx playwright test e2e/mobile-landing-entry.spec.ts e2e/landing-find-my-pint.spec.ts --project=chromium
```

Expected: existing specs still pass on `/choose-city` until you flip the assertions; new Tonight / `/map` assertions RED.

**Step 3: CSS + hrefs**

Replace `display: none` on `.lpPrimaryNav` with a compact visible row **or** accept that the header stays hidden and put Tonight on `.lpHeroSecondaryRow`. Measure at 320 / 390 / 430. No overlay may steal the hit (`elementFromPoint` at the box centre, same idiom as `e2e/mobile-map-chrome-fit.spec.ts`).

`primaryCtaHref` for Map / “Open the map” becomes `/map` when there is no preferred city. Keep `/choose-city` only on the labelled city picker.

**Step 4: Confirm GREEN**

```
npx vitest run __tests__/landingFindMyPintHierarchy.test.ts __tests__/mobileTabBar.test.ts __tests__/nowTabHref.test.ts
npx playwright test e2e/mobile-landing-entry.spec.ts e2e/landing-find-my-pint.spec.ts --project=chromium
```

Dock still: Now · Map · Out · Social · You. Before 17:00 London, Now still goes to `/today`. Tonight is reachable from the landing. After 17:00, Now already goes to `/tonight`.

---

### Task 4: Freshness honesty follow-up (only if still cheap and still lying)

**#1321 already landed.** It added `lib/priceAuthorityWindow.ts` and drinker-facing `PINT_DATASET_PRESENTATION_BUDGET_DAYS` in `lib/dataFreshness.ts`. DrinkMenu can say “Last seen” vs “Seen”. It does **not** rewrite the Today sidebar.

The battle-test sentence is owned here:

- `app/today/TodayPintsCard.tsx` → `eyebrow()` → `` `${scope}, ${formatPintDatasetAsOf()}` ``
- `formatPintDatasetAsOf()` in `lib/dataFreshness.ts` → `` `as of ${formatObservedDate(PINT_DATASET_OBSERVED_AT)}` `` → **“as of 3 July 2026”**
- `__tests__/localityTruthCopy.test.ts` **asserts that exact string**
- Also used by `components/pintindex/PintIndexArrival.tsx`

**Step 1: Preview current `main` (or this branch before Task 4)**

Open `/today` logged-out. If DrinkMenu already says “Last seen 3 Jul 2026” and the Today eyebrow still reads as “current listed prices as of 3 July 2026”, do the follow-up. If a later main commit already reframed it, stop.

**Step 2: Reframe, do not redate**

Change the Today (and only the Today) eyebrow so a July collection cannot read as today’s clock. Keep the dated stamp. Suggested shape: “Lowest listed prices in central London. Last collected 3 July 2026.” Do not invent a September collection date.

Update:

- `__tests__/localityTruthCopy.test.ts`
- `__tests__/onePriceClock.test.ts` / `__tests__/priceFreshnessHonesty.test.ts` (`AS_OF_LABEL`) if they pin the Today eyebrow
- `docs/FRESHNESS_BURNDOWN.md` only if a sentence there claims the Today card is already honest

Leave `PINT_INDEX` live page and dated editions alone. Recollection remains issue **#1329**.

```
npx vitest run __tests__/localityTruthCopy.test.ts __tests__/priceFreshnessHonesty.test.ts __tests__/onePriceClock.test.ts
```

---

## Preview-only verify list

Deploy a preview. Do **not** promote. Logged-out, London, desktop 1440 and phone 390×844.

1. **`/tonight`**
   - First card is an independent listed pub **or** the quiet-night sentence.
   - No Curry Club®, no “via J D Wetherspoon”, no Ticketmaster / Lily Seabird as the lede or the On-tonight named examples.
   - `/api/whats-on` and `/api/out` may still return JDW / TM; the **page** must not lede with them.
   - `/api/tonight` may still 404.

2. **Hatton Drinks**
   - Open `/map?sel=venue-1vle947` (or search “Hatton”).
   - Drinks tab shows Lager £4.50 from the public pint-drop.
   - Empty sentence is absent while that drop is visible.
   - Pin colour / cheapest buckets unchanged by this single drop.

3. **Landing nav**
   - Phone 390×844: Map, Plan, and Tonight each have a non-null box ≥44×44. Centre point hits the link.
   - Map navigates to `/map`, not `/choose-city`.
   - Tonight navigates to `/tonight` before 17:00 London.
   - Dock still has five items; no sixth “Tonight” tab.
   - Desktop landing header Map → `/map`. “Pick your city” still reaches `/choose-city`.

4. **`/today` (if Task 4 shipped)**
   - Sidebar must not present 3 July 2026 as the current listed-price clock.
   - Date may still appear as last-collected / last-seen.

5. **Regression smoke**
   - `/out` still lists sourced events (Ticketmaster may remain there; `/out` is not Tonight’s lede).
   - SiteNav Map on an inner page is still `/map`.
   - `npm run typecheck` and the focused vitest / Playwright commands above.

---

## Suggested PR shape (implementer)

One preview PR from `cursor/v0-three-bar-preview-ca01` (or the implementer’s own `cursor/…-ca01`) against `main`.

Commit per bar (do not batch unless a test forces a pair):

1. `fix(tonight): keep chain deals and Ticketmaster off the primary lede`
2. `fix(drinks): render public pint-drops on the venue Drinks tab`
3. `fix(landing): tappable Map Plan Tonight and Map to /map`
4. `fix(today): stop presenting the July pint dataset as current` (only if Task 4 is needed)

PR body: Summary of the three bars, Security checklist N/A (no new write path), Test plan = the commands in each task plus the preview list.

---

## Out of scope (repeat)

Pal, Social, WebMCP #1318, merging #1237, promoting to production, GitHub Actions billing, inventing `/api/tonight`, sixth dock tab, map `uk_base` 500 / “Map background couldn't load”, recolecting the pint dataset (#1329).
