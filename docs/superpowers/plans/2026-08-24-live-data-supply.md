# Live Data Supply Recovery Implementation Plan

> **For agentic workers:** Use test-driven development for feed behavior. Use direct provider APIs, not page scraping, unless a source licence and parser contract explicitly permit it.

**Goal:** Make Out and Tonight show current, pub-linked information with visible provider and freshness evidence.

**Current fact:** Production `/api/out` returns 31 Ticketmaster rows and reports Ticketmaster configured. Production `/api/whats-on` returns zero rows. These are different pipelines. Merged request-time venue matching is not deployed yet, so the live Out page hides unmatched supply.

### Task 1: Close request-time event honesty defects

**Files:**
- Modify: `lib/out/loadOut.ts`
- Modify: `__tests__/outRoute.test.ts`
- Modify: `__tests__/outVenueMatching.test.ts`

- [ ] Reproduce same-night expired events still being served.
- [ ] Write failing tests for effective end before request time.
- [ ] Apply request-time matching only to live provider rows. Do not rematch bundled rows with a weaker contract.
- [ ] Keep unmatched counts explicit and never render a Ticketmaster event as a pub event without a Venue Dataset match.

### Task 2: Refresh and certify bundled feeds

**Files:**
- Review and repair: `scripts/whatson/eventsRefresh.mjs`, `musicRefresh.mjs`, `quizRefresh.mjs`, `dealsRefresh.mjs`, `sportFixtures.mjs`
- Modify: `.github/workflows/events-refresh.yml` only after GitHub Actions allocation is restored.
- Modify: `data/freshness_registry.json` only when cadence or source changes.

- [ ] Run each lane independently and record rows, source date, match rate, runtime, and failure.
- [ ] Keep Common lane keyless and independent of Ticketmaster.
- [ ] Refresh or explicitly mark stale July sport fixtures.
- [ ] Remove empty compatibility artifacts only after all readers are migrated.

### Task 3: Provider gates

- [ ] Ticketmaster: keep current Discovery API key and certify London request, quotas, timeouts, venue match rate, and attribution.
- [ ] Skiddle: require written commercial approval, usable credentials, and official logo asset before lifting current fence.
- [ ] Eventbrite: use organiser-authorised events only. Do not present it as broad London discovery.
- [ ] CityMCP: certify current contract and stale-result behavior before it can support `/api/whats-on`.

### Task 4: Operations

- [ ] Resolve issue #1181 GitHub Actions allocation or billing outside code.
- [ ] Until then, run direct local refresh with reviewable output and open a focused data PR.
- [ ] Add PostHog events for provider configured, rows fetched, matched, served, unmatched, and degraded. Keep provider and status low-cardinality.
- [ ] Alert on zero served rows, stale artifacts, unknown freshness, and match-rate collapse as separate findings.
- [ ] Final deployment uses clean `main` in Vercel project `chengdu` after full release checklist passes.
