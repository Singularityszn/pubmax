# Pint Drop Posting End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a real signed-in user submit a Pint Drop with a privacy-safe photo, persist it in Supabase, and read it back in the feed and venue sheet.

**Architecture:** Keep `/api/pint-drops` as the only write seam. The composer sends multipart form data, the server validates bytes, removes metadata, normalises the image, uploads through the service-role Storage client, then inserts the visit report and returns short-lived signed URLs. Storage SQL grants authenticated read access to Pint Drop objects while application visibility and URL issuance remain server-controlled.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth and Storage, Sharp, Playwright Firefox, Vitest.

## Global Constraints

- Never apply the Storage migration to the live Supabase project.
- Never weaken magic-byte validation, metadata stripping, or Sharp normalisation.
- Do not change page copy, headlines, or information architecture.
- Run one command or long-running process at a time, and stop processes started by this work.
- Do not commit from the agent; the orchestrator owns commits.
- Every implementation slice must pass `npx tsc --noEmit`, `npm run lint`, and the relevant unit tests without reducing the suite below 7490.
- Final proof must use Playwright Firefox at 390x844 and 1440x900 in light and dark themes.

## File Map

- `lib/savedPubs.ts`: browser-safe saved-venue key logic; currently blocks map hydration because its delimiter is a literal NUL byte in a template literal.
- `__tests__/profiles.test.ts`: pure saved-key regression coverage can run without browser dependencies.
- `supabase/migrations/20260804120000_0065_private_pint_drop_storage_policies.sql`: authenticated read policy for the private Pint Drop bucket, with no client write policy.
- `lib/pintDropsStore.ts`: existing fail-closed photo pipeline, Storage upload, signed URL resolution, and orphan cleanup. Change only if an observed integration failure proves a missing seam.
- `components/map/PintDropComposer.tsx` and `components/map/usePintDrops.ts`: existing multipart composer path. Change only if browser reproduction identifies a client seam defect.
- `app/feed/` and `components/feed/`: existing public feed read path. Add only targeted proof assertions if the returned drop or photo is not rendered.
- `e2e/pint-drop-posting-firefox.spec.ts`: Firefox proof for signed-out gate, signed-in photo submission, feed readback, venue-sheet readback, and committed screenshots.
- `docs/proof/pint-drop-posting/`: committed Firefox screenshots and a short evidence manifest with viewport, theme, drop id, and photo URL presence.

---

### Task 1: Restore map hydration

**Files:**
- Modify: `__tests__/profiles.test.ts`
- Modify: `lib/savedPubs.ts`

**Interfaces:**
- Consumes: `savedKey(venueId: string, listType: string)`.
- Produces: a JavaScript-valid saved key containing a stable NUL delimiter, allowing the map bundle to import `savedPubs`.

- [ ] **Step 1: Write the failing test**

Add a pure regression test that imports `savedKey` and expects the hand-derived key `venue-1\u0000Want to Visit`.

- [ ] **Step 2: Run the targeted test and verify the current failure**

Run: `npx vitest run __tests__/profiles.test.ts`

Expected: transform failure at `lib/savedPubs.ts` because the current template literal contains a literal NUL byte.

- [ ] **Step 3: Replace the literal control byte with an escaped delimiter**

Change the return expression to:

```ts
return `${venueId}\u0000${listType}`;
```

- [ ] **Step 4: Run the targeted test**

Run: `npx vitest run __tests__/profiles.test.ts`

Expected: PASS, including the new saved-key regression.

- [ ] **Step 5: Run map-adjacent type and lint checks**

Run: `npx tsc --noEmit` and `npm run lint`

Expected: exit 0 for both.

---

### Task 2: Add the unapplied private Storage policy migration

**Files:**
- Create: `supabase/migrations/20260804120000_0065_private_pint_drop_storage_policies.sql`

**Interfaces:**
- Consumes: private `pint-drops` bucket, server-issued signed URLs, and the existing `visit_reports` Storage key columns.
- Produces: authenticated object reads only; no anon read, insert, update, or delete policy.

- [ ] **Step 1: Write the migration**

Create an idempotent migration that revokes client write privileges, drops/replaces the named Pint Drop read policy, and grants `authenticated` `SELECT` on `storage.objects` for `bucket_id = 'pint-drops'`. Document that the server remains the visibility authority because it only issues signed URLs for rows the requester may see, while the policy prevents anonymous bucket reads.

- [ ] **Step 2: Verify it is not applied**

Run: `git diff -- supabase/migrations/20260804120000_0065_private_pint_drop_storage_policies.sql` and do not run any Supabase migration command.

Expected: only a local SQL file exists; no network write or migration application occurs.

- [ ] **Step 3: Run SQL-adjacent repository checks**

Run: `npx tsc --noEmit`, `npm run lint`, and the relevant Pint Drop store tests.

Expected: exit 0, with signed URL and bucket key behaviour unchanged.

---

### Task 3: Prove the server photo path with a real browser request

**Files:**
- Create: `e2e/pint-drop-posting-firefox.spec.ts`
- Modify: `playwright.config.ts` only if a dedicated Firefox project is needed for the proof.

**Interfaces:**
- Consumes: `PintDropComposer`, `usePintDrops`, `POST /api/pint-drops`, and the configured Supabase Auth session.
- Produces: a persisted drop whose DTO contains signed photo URLs and whose feed and venue reads render the same drop.

- [ ] **Step 1: Add a signed-out assertion**

At 390x844, open the same venue without a session and assert the account-first sign-in surface appears before authoring controls. Keep the assertion read-only.

- [ ] **Step 2: Add the signed-in photo submission**

Restore a real Supabase Auth session or complete the configured provider flow. Use a valid PNG fixture supplied as Playwright bytes, submit one unique drop, and assert `POST /api/pint-drops` returns 201, the response has a non-null signed Pint Drop photo URL, and the URL does not expose a Storage public-object path.

- [ ] **Step 3: Assert readback in both surfaces**

Open `/feed` and the venue sheet, then assert the unique story and photo are visible. Assert no page errors and no failed Storage request.

- [ ] **Step 4: Capture Firefox evidence**

Run the proof at 390x844 and 1440x900 for light and dark themes. Save screenshots under `docs/proof/pint-drop-posting/` and record the exact drop id and viewport in the manifest.

- [ ] **Step 5: Run the complete verification gates**

Run: `npx tsc --noEmit`, `npm run lint`, `npm test`, and the Firefox proof command with the e2e port free.

Expected: typecheck and lint clean, unit suite at least 7490, and all four screenshot proofs pass.

---

## Self-review

- The current implementation already performs magic-byte validation, pure metadata stripping, Sharp re-encoding, deterministic upload keys, signed URL reads, and orphan cleanup. No replacement path is planned.
- The migration is deliberately unapplied and adds no bucket creation or live-project command.
- The plan preserves the existing feed and venue-sheet information architecture and changes only the map-blocking syntax defect, storage policy, and browser proof.
