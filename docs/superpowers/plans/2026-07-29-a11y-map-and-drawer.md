# Map and Drawer Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development and executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give keyboard and screen-reader users an honest in-view venue list, keep desktop drawer focus contained and restored, and bring coral CTA text to WCAG AA.

**Architecture:** Keep MapLibre canvas unchanged. Publish its settled geographic bounds to `PubMap`, derive a pure in-bounds venue set from already-filtered map membership, and render that set through existing `MapVenueList` native buttons. Reuse existing shared focus trap for every open desktop venue drawer and preserve list focus source across drawer open and close.

**Tech Stack:** Next.js 16, React 19, TypeScript, MapLibre GL 6, Vitest, Playwright, CSS custom properties.

## Global Constraints

- Do not change map density, clustering, collision, or canvas hit-testing contracts.
- Do not redesign map or venue sheet.
- Keep coral `#ff5a5f` and coral-bright `#ff7a55` unchanged.
- British spelling, no em dashes, no exclamation marks in product copy.
- Keyless development and tests must work.
- Keep changes narrow so navigation work rebases normally.

---

### Task 1: Honest in-view venue model

**Files:**
- Modify: `lib/mapVenueList.ts`
- Modify: `__tests__/mapVenueList.test.ts`

**Interfaces:**
- Consumes: filtered `Venue[]` and settled `MapBounds`.
- Produces: `venuesWithinMapBounds(venues: Venue[], bounds: MapBounds | null): Venue[]`.

- [ ] **Step 1: Write failing bounds tests**

Add literal fixtures proving inside, edge, outside, null-bounds, and west-greater-than-east bounds:

```ts
expect(venuesWithinMapBounds([inside, outside], bounds).map((venue) => venue.id))
  .toEqual(["inside"]);
expect(venuesWithinMapBounds([inside], null)).toEqual([]);
```

Also replace production-default truncation expectations with a test proving every supplied in-view venue stays reachable. Keep an explicit custom-limit test only for helper flexibility.

- [ ] **Step 2: Run test and verify red**

Run:

```bash
npx vitest run __tests__/mapVenueList.test.ts
```

Expected: import or assertion failure because viewport filter and unbounded production default do not exist.

- [ ] **Step 3: Implement pure bounds filter**

Implement finite-coordinate inclusive checks with wrapped-longitude support:

```ts
export function venuesWithinMapBounds(
  venues: Venue[],
  bounds: MapBounds | null,
): Venue[] {
  if (!bounds) return [];
  const longitudeInside = bounds.west <= bounds.east
    ? (longitude: number) => longitude >= bounds.west && longitude <= bounds.east
    : (longitude: number) => longitude >= bounds.west || longitude <= bounds.east;
  return venues.filter((venue) =>
    Number.isFinite(venue.latitude) &&
    Number.isFinite(venue.longitude) &&
    venue.latitude >= bounds.south &&
    venue.latitude <= bounds.north &&
    longitudeInside(venue.longitude)
  );
}
```

Use all supplied venues by default when building list rows. Optional explicit limits may still truncate.

- [ ] **Step 4: Run test and verify green**

Run the same Vitest command. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/mapVenueList.ts __tests__/mapVenueList.test.ts
git commit -m "test(a11y): define honest in-view venue list"
```

### Task 2: Keyboard path and live map updates

**Files:**
- Modify: `components/PubMap.tsx`
- Modify: `components/map/MapVenueList.tsx`
- Modify: `__tests__/mapVenueListComponent.test.ts`
- Create: `e2e/map-accessibility.spec.ts`

**Interfaces:**
- Consumes: `PubMapCanvas.onBoundsChange(bounds)` on first idle and each move end.
- Produces: visible list whose row buttons call existing `selectVenue(id)` or `handleUkBasePubClick(pub)`.

- [ ] **Step 1: Write failing browser and component tests**

Browser test uses keyboard only:

```ts
while (!(await page.evaluate(() => document.activeElement?.textContent?.includes("List view")))) {
  await page.keyboard.press("Tab");
}
await page.keyboard.press("Enter");
await expect(page.locator(".mapVenueListItem").first()).toBeFocused();
const venueName = await page.locator(".mapVenueListItemName").first().innerText();
await page.keyboard.press("Enter");
await expect(page.locator(".mapDrawer.right.open")).toContainText(venueName);
```

Add a component assertion that each row remains a native button with name, venue type, distance when available, and price finding. Add a browser assertion that zooming the map changes the open list count to the new viewport.

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
npx vitest run __tests__/mapVenueList.test.ts __tests__/mapVenueListComponent.test.ts
PW_SKIP_WEBSERVER=1 npx playwright test e2e/map-accessibility.spec.ts --project=chromium --workers=1
```

Expected: focus remains on toggle and list count describes all loaded venues rather than current bounds.

- [ ] **Step 3: Wire settled bounds into list**

Store city-tagged settled bounds in `PubMap`. Update bounds before shard-loading work, derive:

```ts
const inViewMapVenues = useMemo(
  () => venuesWithinMapBounds(
    kindVisibleMapVenues,
    mapBoundsState?.cityId === cityId ? mapBoundsState.bounds : null,
  ),
  [cityId, kindVisibleMapVenues, mapBoundsState],
);
```

Build `mapVenueListModel` from `inViewMapVenues`. Continue using `renderedBasePubs`, already bounded by base streaming.

- [ ] **Step 4: Give list deliberate focus**

When list opens, focus first real venue button, or close button for an empty list. Do not close list state when a row opens a venue. CSS hides it while drawer owns map, keeping row connected so drawer close can restore focus to exact row.

- [ ] **Step 5: Run tests and verify green**

Run commands from Step 2. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add components/PubMap.tsx components/map/MapVenueList.tsx __tests__/mapVenueListComponent.test.ts e2e/map-accessibility.spec.ts
git commit -m "feat(a11y): open in-view venues from keyboard list"
```

### Task 3: Desktop drawer focus containment and Escape restore

**Files:**
- Modify: `components/PubMap.tsx`
- Modify: `e2e/map-accessibility.spec.ts`

**Interfaces:**
- Consumes: `useFocusTrap(active, detailDrawerRef)` and existing `useMapKeyboardShortcuts` Escape path.
- Produces: modal desktop drawer semantics for full desktop open lifetime.

- [ ] **Step 1: Write failing focus-cycle test**

Open a real venue through list, then prove both edges remain inside drawer:

```ts
const drawer = page.locator(".mapDrawer.right.open");
await drawer.locator("button:visible").last().focus();
await page.keyboard.press("Tab");
await expect(drawer.getByRole("button", { name: /Close/ })).toBeFocused();
await page.keyboard.press("Shift+Tab");
await expect(drawer.locator(":focus")).toHaveCount(1);
```

Press Escape, assert drawer closes and original list row regains focus.

- [ ] **Step 2: Run test and verify red**

Run the targeted Playwright command. Expected: focus escapes because desktop sheet snap stays `half`, so current trap never activates.

- [ ] **Step 3: Activate trap for full desktop open state**

Change trap and semantics:

```ts
useFocusTrap(!mobileViewport && detailOpen, detailDrawerRef);
aria-modal={detailOpen ? true : undefined}
role={detailOpen ? "dialog" : undefined}
```

Keep mobile detent behaviour unchanged because mobile uses `MobileSharedSheet`.

- [ ] **Step 4: Run test and verify green**

Run targeted Playwright test. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add components/PubMap.tsx e2e/map-accessibility.spec.ts
git commit -m "fix(a11y): trap desktop venue drawer focus"
```

### Task 4: Coral CTA contrast

**Files:**
- Modify: `app/globals.css`
- Modify: `app/theme.css`

**Interfaces:**
- Consumes: locked coral gradient `#ff5a5f` to `#ff7a55` and existing `--color-on-accent-strong: #16122a`.
- Produces: normal CTA contrast of at least 5.96:1 across gradient.

- [ ] **Step 1: Measure current and target ratios**

Use WCAG 2 relative luminance. Expected current minimum is 2.47:1 across full gradient, with 2.93:1 at coral start. Expected dark-ink minimum is 5.96:1 at coral start.

- [ ] **Step 2: Apply scoped text colour**

Use:

```css
.planBtn {
  color: var(--color-on-accent-strong);
}

html[data-theme="dark"] .planBtn {
  color: var(--color-on-accent-strong);
}
```

Leave `.planBtn.active` on dark inverse fill with `--color-on-inverse`.

- [ ] **Step 3: Verify computed styles**

Inspect light and dark `Plan tonight` buttons in browser, confirm computed foreground and both locked gradient endpoints, then recompute minimum ratio.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css app/theme.css
git commit -m "fix(a11y): raise coral CTA text contrast"
```

### Task 5: Closeout, evidence, and PR

**Files:**
- Modify only files required by verification findings.

**Interfaces:**
- Consumes: completed commits.
- Produces: green verification and PR body with keyboard, screen-reader, focus, and contrast evidence.

- [ ] **Step 1: Run focused checks**

```bash
npx vitest run __tests__/mapVenueList.test.ts __tests__/mapVenueListComponent.test.ts
PW_SKIP_WEBSERVER=1 npx playwright test e2e/map-accessibility.spec.ts --project=chromium --workers=1
npm run lint
npm run typecheck
```

- [ ] **Step 2: Run project gate**

```bash
npm run verify
```

- [ ] **Step 3: Manual keyboard and screen-reader pass**

At desktop 1440 by 900:

1. Reload `/map` with no prior pointer action.
2. Tab to List view, press Enter, hear region/list count and first venue name, kind, distance, and price.
3. Press Enter to open venue drawer.
4. Cycle Tab and Shift+Tab around drawer edges.
5. Press Escape and confirm focus returns to chosen row.
6. Move map and change one filter, then confirm list count and rows update.

Record VoiceOver commands and announcements in PR body.

- [ ] **Step 4: Restore tooling churn**

```bash
git checkout -- next-env.d.ts package.json
```

Only run second path if install tooling changed it. Confirm clean worktree except intentional files.

- [ ] **Step 5: Create PR**

Use `gh-axi`. PR body must justify visible List view against keyboard experience, state 5.96:1 minimum CTA ratio, and record VoiceOver verification.
