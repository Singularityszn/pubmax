# QA Truth Defects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Tonight, dated Pint Index editions, locality surfaces, and Stories from displaying facts their inputs do not establish.

**Architecture:** Preserve uncertainty at data boundaries. An exact event start becomes optional and raw listed-time evidence remains displayable; archived pages read only archived files; locality copy derives from explicit basis; unscoped geographic navigation stays hidden.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, React server rendering.

## Global Constraints

- Keep scope to D02, D03, D04, and D05.
- Do not weaken frozen-edition promises.
- Use plain, direct product voice with British spelling, no em dash, and no exclamation mark.
- Write and run each regression test before its production change.
- Avoid unrelated dependency, audit, feed naming, or Cheap round work.

---

### Task 1: Preserve missing Tonight start times

**Files:**
- Modify: `__tests__/whatsOn.test.ts`
- Modify: `__tests__/whatsOnBadges.test.ts`
- Modify: `lib/whatsOn.ts`
- Modify: `lib/whatsOnBadges.ts`
- Modify only as required by optional typing: `lib/concierge/whatsOn.ts`, `lib/events/provider.ts`

**Interfaces:**
- Consumes: CityMCP `ThingsToDoOpportunity.timeEvidence` and optional raw `startsAt`.
- Produces: `WhatsOnRow.startsAt?: string`, `WhatsOnRow.timeEvidence?: string`, honest card labels and null urgency for untimed rows.

- [ ] **Step 1: Write failing mapper and presentation tests**

```ts
expect(mapped.startsAt).toBeUndefined();
expect(mapped.timeEvidence).toBe("Tuesdays 6:00pm-9:45pm");
expect(laneTimeLabel(mapped)).toBe("Tuesdays 6:00pm-9:45pm");
expect(listingUrgency(mapped, fixedNow)).toBeNull();
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- __tests__/whatsOn.test.ts __tests__/whatsOnBadges.test.ts`

Expected: FAIL because mapper assigns `windowStart` and drops explicit `timeEvidence`.

- [ ] **Step 3: Implement optional exact starts**

Make `startsAt` optional, preserve `timeEvidence`, accept and normalise rows carrying either a firm start or listed-time evidence, and guard every date consumer. Keep missing-start rows in the already-scoped Tonight live lane without inventing an instant.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- __tests__/whatsOn.test.ts __tests__/whatsOnBadges.test.ts`

Expected: PASS.

### Task 2: Remove live figures from dated Pint Index editions

**Files:**
- Create: `__tests__/pintIndexEditionPage.test.ts`
- Modify: `app/pint-index/[month]/page.tsx`

**Interfaces:**
- Consumes: archived snapshot and archived edition list only.
- Produces: dated page HTML containing no live arrival prices or current dataset stamp.

- [ ] **Step 1: Write failing archived-page render test**

```ts
const html = renderToStaticMarkup(await PintIndexEditionPage({
  params: Promise.resolve({ month: "2026-06" }),
}));
expect(html).toContain("These figures stay put");
expect(html).not.toContain("Right, what about your patch?");
expect(html).not.toContain("collected 3 July 2026");
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- __tests__/pintIndexEditionPage.test.ts`

Expected: FAIL because live map arrival renders on archive page.

- [ ] **Step 3: Remove live page dependencies**

Remove grouped venue loading, current dataset stamp imports, `arrivalAreas`, and archive `PintIndexArrival`. Retain plain live-index and map links outside archived figures.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- __tests__/pintIndexEditionPage.test.ts`

Expected: PASS.

### Task 3: Derive locality and recency copy from known inputs

**Files:**
- Create: `__tests__/localityTruthCopy.test.ts`
- Modify: `app/today/TodayPintsCard.tsx`
- Modify: `app/today/todayPints.ts`
- Modify: `lib/tonight.ts`
- Modify: `app/tonight/TonightClient.tsx`
- Modify: `components/nearme/NearMeNow.tsx`
- Modify: `app/near/page.tsx`

**Interfaces:**
- Consumes: remembered patch resolution, `TonightLocalityBasis`, and `PINT_DATASET_OBSERVED_AT`.
- Produces: Central London fallback copy, locality-backed Tonight heading, and date-backed Near lede.

- [ ] **Step 1: Write failing output tests**

```ts
expect(locationlessTodayHtml).toContain("Cheapest pints in central London today");
expect(tonightHeading("london-default")).toBe("What's on across London tonight.");
expect(nearIntroLede(PINT_DATASET_OBSERVED_AT)).toContain("prices collected July 2026");
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- __tests__/localityTruthCopy.test.ts`

Expected: FAIL because copy helpers do not exist and current output claims unsupported locality/recency.

- [ ] **Step 3: Implement basis-driven copy**

Track whether Today resolved an actual remembered patch, derive Tonight heading from locality basis, and make Near name the dataset month instead of saying `right now`. Update matching metadata and accessible labels.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- __tests__/localityTruthCopy.test.ts`

Expected: PASS.

### Task 4: Hide unscoped Nearby feed tab

**Files:**
- Create: `__tests__/socialTabs.test.ts`
- Modify: `components/feed/SocialTabs.tsx`

**Interfaces:**
- Consumes: no locality input.
- Produces: only `Your lot` and `London` tabs until a locality-bearing feed exists.

- [ ] **Step 1: Write failing rendered-tab test**

```ts
expect(html).toContain("Your lot");
expect(html).toContain("London");
expect(html).not.toContain("Nearby");
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- __tests__/socialTabs.test.ts`

Expected: FAIL because `Nearby` is always rendered.

- [ ] **Step 3: Remove Nearby from visible tab definitions**

Keep existing feed internals untouched for ordinary rebase compatibility, but do not expose the geographic tab without a locality.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- __tests__/socialTabs.test.ts`

Expected: PASS.

### Task 5: Verify and close

**Files:**
- Review all files above.

**Interfaces:**
- Consumes: completed D02-D05 changes.
- Produces: clean committed branch.

- [ ] **Step 1: Run focused regression suite**

Run: `npm test -- __tests__/whatsOn.test.ts __tests__/whatsOnBadges.test.ts __tests__/pintIndexEditionPage.test.ts __tests__/localityTruthCopy.test.ts __tests__/socialTabs.test.ts`

- [ ] **Step 2: Run project verification**

Run: `npm run verify`

- [ ] **Step 3: Review diff and generated-file churn**

Run: `git diff --check && git status --short && git diff --stat && git diff`

- [ ] **Step 4: Commit**

```bash
git add <scoped files>
git commit -m "fix: stop unsupported time and locality claims"
```
