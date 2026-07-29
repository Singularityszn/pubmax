# Postcode-coordinate consistency implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove contradictory venue rows from product output and make postcode-to-coordinate contradictions fail data validation.

**Architecture:** Keep raw evidence auditable in a quarantine registry, but remove quarantined rows from app-facing CSV, JSON, slim, and detail artifacts. Add a dependency-free validator that derives robust outward-code reference points from committed UK OpenStreetMap pub data, compares app rows with a measured 5 km threshold, and accepts only exact, reasoned exceptions from a committed registry.

**Tech Stack:** Node.js ESM, Vitest, existing JSON and CSV datasets, committed OpenStreetMap UK pub extract

## Global constraints

- Do not add a geocoding service or third-party dependency.
- Contradictory product rows must fail validation.
- Evidence decides correction versus quarantine.
- Exceptions must identify one exact row and state a reason.
- Commit each coherent task separately.

---

### Task 1: Quarantine The Lincoln Arms

**Files:**

- Create: `data/postcode_coordinate_quarantine.json`
- Modify: `data/pub_locations_map_data.csv`
- Modify: `data/pint_prices_app_dataset.csv`
- Modify: `data/all_pint_prices_combined.csv`
- Modify: `public/data/pint_prices_app_dataset.json`
- Modify: `public/data/venues_slim*.json`
- Modify: `data/generated/venue_detail_index.json`
- Modify: `data/generated/venue_details.jsonl`
- Test: `__tests__/postcodeCoordinateConsistency.test.ts`

**Interfaces:**

- Consumes: exact Lincoln Arms source URL, source-page postcode and coordinates, independent King's Cross and Enfield venue evidence
- Produces: quarantine record and product artifacts with no contradictory Lincoln Arms row

- [ ] **Step 1: Write exact regression test**

  Load `public/data/pint_prices_app_dataset.json` and assert no row combines `The Lincoln Arms`, `EN1 1QT`, `51.5332`, and `-0.1222`.

- [ ] **Step 2: Verify regression test fails against unfixed data**

  Run `npx vitest run __tests__/postcodeCoordinateConsistency.test.ts`.
  Expected: FAIL because `app_price_000339` is present.

- [ ] **Step 3: Record evidence and quarantine**

  Add a quarantine registry entry naming `app_price_000339`, all three raw source seams, the contradictory source page, and independent evidence that both King's Cross `N1 9AB` and Enfield `EN1 1QT` venues exist. Remove the ambiguous row from all app-facing and cited source datasets rather than assigning its price to either venue.

- [ ] **Step 4: Rebuild shipped venue artifacts**

  Run `npm run build:slim`.

- [ ] **Step 5: Verify exact regression passes**

  Run `npx vitest run __tests__/postcodeCoordinateConsistency.test.ts`.
  Expected: PASS.

- [ ] **Step 6: Commit**

  Commit message must state source evidence, why it did not settle price ownership, and that the regression test failed on unfixed data.

### Task 2: Add fail-loud consistency validation

**Files:**

- Create: `scripts/lib/postcodeCoordinateConsistency.mjs`
- Create: `data/postcode_coordinate_exceptions.json`
- Modify: `scripts/validate-data.mjs`
- Modify: `data/README.md`
- Test: `__tests__/postcodeCoordinateConsistency.test.ts`
- Test: `__tests__/validateDrinkPriceUpdatesScript.test.ts`

**Interfaces:**

- Consumes: app rows shaped as `{ app_price_id, pub_name, address, latitude, longitude }`, committed `data/osm/uk/uk_osm_pubs.json`, and exact exception records
- Produces: `findPostcodeCoordinateContradictions(rows, osmPubs, exceptions, { maxDistanceKm: 5 })`

- [ ] **Step 1: Write failing unit tests**

  Test exact Lincoln fixture at King's Cross coordinates with `EN1 1QT`, a consistent London fixture, malformed or missing postcodes, and exact exception matching. Verify a stale, partial, or reasonless exception is rejected.

- [ ] **Step 2: Write failing validate-data integration test**

  In a scratch dataset, inject the exact Lincoln contradiction and assert actual `validate-data.mjs` output contains a postcode-coordinate contradiction and exits nonzero.

- [ ] **Step 3: Verify tests fail for missing validation**

  Run `npx vitest run __tests__/postcodeCoordinateConsistency.test.ts __tests__/validateDrinkPriceUpdatesScript.test.ts`.

- [ ] **Step 4: Implement dependency-free validator**

  Parse full UK postcodes from address text, group committed OSM pubs by outward code, use coordinate-wise medians as robust reference points, compute haversine distance, and report every row over 5 km unless its exception matches all identity fields and has a substantive reason.

- [ ] **Step 5: Wire validator into app dataset gate**

  Add every contradiction or invalid exception to `validatePintPrices()` error collector so `npm run validate-data` fails.

- [ ] **Step 6: Document threshold and exception format**

  In `data/README.md`, state the 5 km measured boundary, reference dataset, fail behavior, exact exception fields, and rule that exceptions are only for verified odd geography.

- [ ] **Step 7: Verify focused tests pass**

  Run `npx vitest run __tests__/postcodeCoordinateConsistency.test.ts __tests__/validateDrinkPriceUpdatesScript.test.ts`.

- [x] **Step 8: Commit**

  Commit message must report measured distributions: 1,296 unique app venues checked, 99th percentile 3.65 km, last below-threshold row 3.87 km, first contradiction 5.44 km, and chosen 5 km boundary.

### Task 3: Apply whole-dataset findings

**Files:**

- Modify: `data/postcode_coordinate_quarantine.json`
- Modify: `data/pint_prices_app_dataset.csv`
- Modify: `data/pub_locations_map_data.csv`
- Modify: `data/all_pint_prices_combined.csv`
- Modify: `public/data/pint_prices_app_dataset.json`
- Modify: generated slim and detail artifacts

**Interfaces:**

- Consumes: whole-dataset contradiction report from Task 2
- Produces: zero unexcepted contradictions in product data and an explicit disposition for every caught venue

- [ ] **Step 1: Run whole-dataset check**

  Run `npm run validate-data` and capture all postcode-coordinate findings.

- [ ] **Step 2: Evaluate each finding**

  Compare recorded source URL with committed OSM exact-postcode evidence. Correct only when evidence settles price ownership and location; otherwise append a named quarantine entry.

- [ ] **Step 3: Remove quarantined rows from product and source datasets**

  Remove every caught app price ID plus corresponding contradictory map and combined rows. Keep source URL, original fields, evidence summary, and disposition in quarantine registry.

- [ ] **Step 4: Rebuild shipped artifacts**

  Run `npm run build:slim`.

- [ ] **Step 5: Verify whole-dataset check is clean**

  Run `npm run validate-data` and focused regression tests.

- [ ] **Step 6: Commit**

  Commit message must list total rows, unique venues, each venue name, and its correction or quarantine disposition.

### Task 4: Make postcode-coordinate decisions rebuild-durable

**Files:**

- Modify: `scripts/build_app_dataset.py`
- Modify: `scripts/validate-data.mjs`
- Modify: `data/postcode_coordinate_quarantine.json`
- Create: `data/postcode_coordinate_corrections.json`
- Modify: `data/README.md`
- Test: `__tests__/buildAppDatasetQuarantine.test.ts`
- Test: `__tests__/validateDrinkPriceUpdatesScript.test.ts`

**Interfaces:**

- Consumes: complete pre-publication app rows after `app_price_id` assignment, exact quarantine records, exact correction records, and committed OSM outward-code reference points
- Produces: corrected product rows, no quarantined product rows, one visible build log line per skipped row, and hard failures for invalid or stale decision records

- [x] **Step 1: Reproduce raw rebuild failure**

  Copy the data pipeline into a scratch directory, run `build_app_dataset.py`, export product JSON, and run `validate-data.mjs`. Record that all 12 quarantined rows and all 10 previously corrected rows return.

- [x] **Step 2: Write failing build integration tests**

  Run the real builder against scratch copies of committed raw inputs. Assert each exact quarantine row is absent, every skip is printed with its reason, and the Sir Michael Balcon correction survives.

- [x] **Step 3: Write failing quarantine integrity tests**

  Assert stale, partial, duplicate, reasonless, and no-longer-contradictory quarantine records fail. Assert one record may identify only one exact app price ID, name, postcode, latitude, and longitude.

- [x] **Step 4: Implement build-time decisions**

  Assign app price IDs before decisions, apply exact evidence-backed corrections, validate quarantine records against pre-publication rows and the same 5 km contradiction rule, print every skip and reason, then omit quarantined rows from product output.

- [x] **Step 5: Wire quarantine integrity into validation**

  Validate registry schema, exact identity, raw-source presence, duplicate IDs, stated reasons, ongoing contradiction, and absence from published product data. Fail rather than warn on every invalid state.

- [x] **Step 6: Document durable rebuild behavior**

  Put correction and quarantine maintenance rules beside the existing exception documentation, including why raw scrape artifacts remain untouched.

- [x] **Step 7: Prove raw rebuild and stale-entry failure**

  Run the data build from committed raw inputs, export product JSON, rebuild derived product packs, and run validation. Confirm all 11 quarantined venues stay absent and validation is green. In a scratch copy, deliberately stale one exact quarantine identity and confirm the builder and validation fail.

- [ ] **Step 8: Commit**

  Commit the durable decision path and its tests as one coherent piece.

### Task 5: Closeout verification

**Files:**

- Review all changed files

**Interfaces:**

- Consumes: four committed tasks
- Produces: verified branch ready for firstmate review

- [ ] **Step 1: Run project gate**

  Run `npm run verify`.

- [ ] **Step 2: Run browser verification**

  At 390 by 844, confirm searching for The Lincoln Arms no longer opens the contradictory product row or emits the Enfield booking query.

- [ ] **Step 3: Review diff and generated churn**

  Run project-required review, check-work, and verification playbooks. Revert only known local tooling churn.

- [ ] **Step 4: Commit any verification-only corrections**

  Leave branch clean and append final status.
