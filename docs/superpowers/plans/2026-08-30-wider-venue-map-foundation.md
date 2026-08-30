# Wider Venue Map Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream and draw neutral non-pub London Venues at street zoom without granting them pub or price authority.

**Architecture:** Extend the existing London shard decoder with a bounded viewport loader. A small React hook owns camera-settle loading and writes a source-only GeoJSON collection. `buildScene` owns one collision-aware label layer below both pub layers.

**Tech Stack:** Next.js 16, React 19, TypeScript, MapLibre GL 6, Vitest

**Spec:** `docs/specs/2026-08-30-wider-venue-map-foundation.md`

## Global Constraints

- Enable only for London.
- Start loading and drawing at zoom 15.
- Exclude `pub` rows.
- Map properties contain only `id`, `name`, `address`, and `kind`.
- Never add price, band, freshness, trust, cheapest, or Pint Index authority.
- All symbol labels participate in MapLibre collision placement.
- Work in `codex/uk-venue-map` and push completed work to GitHub.
- Do not run browser, build, or full suite while current memory and disk gate is red.

---

### Task 1: Bounded wider Venue loader

**Files:**
- Modify: `lib/londonVenueShards.ts`
- Modify: `__tests__/londonVenueShards.test.ts`

**Interfaces:**
- Consumes: `parseLondonVenueManifest`, `parseLondonVenueShardForEntry`, `MapBounds`, `ShardEntry`
- Produces: `LONDON_VENUE_MANIFEST_PATH`, `MAX_LONDON_VENUE_RESIDENT_SHARDS`, `LondonVenueLoader`, `createLondonVenueLoader()`

- [ ] **Step 1: Write failing tests**

Add tests that call `createLondonVenueLoader().venuesForBounds(bounds)` against literal manifest and shard responses. Assert that only intersecting shard URLs load, repeated reads use residency, failed shards retry, returned rows exclude `pub`, and `residentShardCount()` never exceeds the exported cap.

- [ ] **Step 2: Verify RED**

Run: `npm test -- __tests__/londonVenueShards.test.ts`

Expected: FAIL because `createLondonVenueLoader` and its constants do not exist.

- [ ] **Step 3: Add minimal loader**

Use one manifest promise, per-URL in-flight deduplication, insertion-ordered LRU residency, `bboxIntersects`, and fail-closed parsing. Return all loaded non-pub Venues for the padded viewport.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- __tests__/londonVenueShards.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/londonVenueShards.ts __tests__/londonVenueShards.test.ts
git commit -m "feat(map): load wider venues by viewport"
```

### Task 2: Authority-free GeoJSON and scene layer

**Files:**
- Modify: `components/map/canvas/geojson.ts`
- Modify: `components/map/canvas/buildScene.ts`
- Modify: `__tests__/londonVenueShards.test.ts`
- Modify: `__tests__/mapSymbolCollision.test.ts`

**Interfaces:**
- Consumes: `readonly LondonVenue[]`
- Produces: `londonVenuesToGeoJSON(venues)`, `WIDER_VENUE_MIN_ZOOM`, `buildWiderVenues(ctx)`, `SceneCtx.widerVenuesData`

- [ ] **Step 1: Write failing tests**

Assert literal GeoJSON properties equal `{ id, name, address, kind }`. Build the real scene against the existing fake MapLibre map and assert `wider-venues-label` starts at zoom 15, disallows overlap, respects placement, and is inserted below `uk-base-point` and `pubs-point`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- __tests__/londonVenueShards.test.ts __tests__/mapSymbolCollision.test.ts`

Expected: FAIL because GeoJSON and scene exports do not exist.

- [ ] **Step 3: Add minimal source and label layer**

Add a GeoJSON source with OSM attribution and one symbol layer whose `text-field` is the Venue name. Use neutral text paint, `text-optional: true`, `text-allow-overlap: false`, and `text-ignore-placement: false`. Assemble it before `buildUkBase`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- __tests__/londonVenueShards.test.ts __tests__/mapSymbolCollision.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/map/canvas/geojson.ts components/map/canvas/buildScene.ts __tests__/londonVenueShards.test.ts __tests__/mapSymbolCollision.test.ts
git commit -m "feat(map): draw neutral wider venues"
```

### Task 3: Camera-settle integration

**Files:**
- Create: `components/map/pubmap/useLondonVenueStreaming.ts`
- Modify: `components/PubMapCanvas.tsx`
- Create: `__tests__/londonVenueStreaming.test.ts`

**Interfaces:**
- Consumes: `createLondonVenueLoader`, `londonVenuesToGeoJSON`, `WIDER_VENUE_MIN_ZOOM`
- Produces: `nextLondonVenueStreamToken(generation, zoom, minZoom)`, `useLondonVenueStreaming(options)`, `data-wider-venue-count`

- [ ] **Step 1: Write failing tests**

Assert a stream token is null below zoom 15 and monotonic at or above it. Assert stale published state is hidden when London is disabled or scope changes.

- [ ] **Step 2: Verify RED**

Run: `npm test -- __tests__/londonVenueStreaming.test.ts`

Expected: FAIL because the hook module does not exist.

- [ ] **Step 3: Add hook and canvas wiring**

Debounce `moveend` and `zoomend` by 180 ms. Clear source data below the gate or outside London. Keep a generation token so slow old requests cannot replace a newer viewport. Pass the source ref into every scene rebuild and expose the count on the map wrapper.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- __tests__/londonVenueStreaming.test.ts __tests__/londonVenueShards.test.ts __tests__/mapSymbolCollision.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/map/pubmap/useLondonVenueStreaming.ts components/PubMapCanvas.tsx __tests__/londonVenueStreaming.test.ts
git commit -m "feat(map): stream wider venues into London map"
```

### Task 4: Focused closeout and GitHub push

**Files:**
- Modify only files required by review findings.

**Interfaces:**
- Consumes: completed Tasks 1-3
- Produces: reviewed commits and remote branch `codex/uk-venue-map`

- [ ] **Step 1: Run focused checks**

Run the three focused Vitest files. Run targeted lint only if repository tooling supports file arguments without loading the full app.

- [ ] **Step 2: Review the diff**

Check every new feature property, source, and label expression against the spec. Confirm no generated data changed and no wider Venue entered a price or pub function.

- [ ] **Step 3: Commit review fixes**

Stage only owned files and create a normal commit if review changed code.

- [ ] **Step 4: Push and verify**

```bash
git push -u origin codex/uk-venue-map
git ls-remote --heads origin codex/uk-venue-map
```

Expected: remote branch resolves to local `HEAD` and worktree is clean.
