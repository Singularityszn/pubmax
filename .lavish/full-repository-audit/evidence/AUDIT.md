# Pubmaxx repository audit

Pinned main: `04b73e834da760ad536ea504f1e4e642940c5963`. Observed production: `db8be121be0bd02c251bb8b00f80b52828e03411`, built 2026-09-20T09:13:24.290Z. Local audit only; no application fixes, merges, migrations or deployments.

## Verdict and limits

Important capabilities survive, but discovery and consumer boundaries break several user promises. Date night is broken in production and current keyless main. Music discovery rejects valid rows. Private-cover privacy and explicit accessibility filters have reachable defects. Good foundations include grounded fallback, measure-aware stores, live identity checks, signed plan grounding, upload re-encoding, effective RLS tests and source-policy infrastructure. Preserve these and fix callers that lose their guarantees.

This is NOT a completed every-file semantic audit or universal regression certification. Every tracked path is reconciled in the ledger; most files received screening or inventory, not full source review. Coverage: {'pattern-screen-only': 10707, 'asset-decoded': 2573, 'inventory-only': 84, 'partial-review': 192, 'static-reviewed': 110, 'link-checked': 881}. Image decoding proves readable output, not correctness or provenance. Source review does not prove deployed RLS. Full historical traversal, secret-history audit, every generator and every feature journey remain incomplete.

## Findings

### SEC-01 P1 Private cover photos remain available through retained URLs

Confirmed source-executed. Source: `lib/profileImageServe.server.ts:156`. A private profile hides cover URLs in JSON, but the image endpoint still serves bytes anonymously and permits shared caching.

Remedy: Apply the same owner/mate boundary to covers; remove shared caching and handle cached old generations. Evidence: [security-repro-parent.json](security-repro-parent.json). Full line-anchored reasoning and acceptance in specialist reports.

### Q-07 P1 Desktop planner ignores required accessibility on slim pins

Confirmed source-executed; desktop path traced. Source: `lib/filterMapVenues.ts:18`. No-price rows bypass step-free, accessible-toilet and seated-service requirements, despite UI promising to hide unknown access.

Remedy: Preserve true/false/unknown evidence rules for both priced and slim cohorts. Evidence: [quality-extra-proofs-parent.json](quality-extra-proofs-parent.json). Full line-anchored reasoning and acceptance in specialist reports.

### Q-02 P1 Half prices can appear as cheap pints

Confirmed source-executed. Source: `app/discover/DiscoverPageClient.tsx:200`. Discover drops serving size before ranking. A £2.60 half can appear under cheap pints.

Remedy: Retain serving identity and enforce pint eligibility at consumer boundaries. Evidence: [non-pint-proof.json](non-pint-proof.json). Full line-anchored reasoning and acceptance in specialist reports.

### H0 P1 Date night asks for history of a fictitious pub

Confirmed in production and local browser. Source: `lib/ask/router.ts:275`. The shipped Date night request becomes a heritage lookup for “date-night with some , calm not loud”. It returns no shortlist.

Remedy: Browse an evidence-backed shortlist; separate general heritage preferences from resolved named-venue questions. Evidence: [browser/date-night-production.txt](browser/date-night-production.txt). Full line-anchored reasoning and acceptance in specialist reports.

### Q-01 P1 Discover silently rejects contemporary music listings

Confirmed source-executed. Source: `components/discovery/MusicTonightLane.tsx:55`. Array.filter supplies its index as the validator clock. A valid modern listing fails validation. Production music supply was empty during audit, so this is a fixture proof of a reachable consumer.

Remedy: Wrap the predicate; test a rendered self-fetch lane using the real row validator. Evidence: [music-filter-proof.json](music-filter-proof.json). Full line-anchored reasoning and acceptance in specialist reports.

### SEC-02 P2 Moderator session expiry exists only in the browser

Confirmed source-executed. Source: `lib/adminAuth.ts:90`. A copied valid cookie remains accepted after 31 days because its digest contains no timestamp.

Remedy: Enforce signed/server-side expiry; reject legacy timeless sessions. Evidence: [security-repro-parent.json](security-repro-parent.json). Full line-anchored reasoning and acceptance in specialist reports.

### SEC-03 P2 Client can release voice quota without recording use

Confirmed source-executed. Source: `app/api/pub-pal/voice-token/route.ts:139`. Authenticated clients report zero duration and regain allowance. Provider single-session cap exists; monthly accounting is bypassable.

Remedy: Reserve bounded use, bind conversation identity, reconcile trusted provider duration idempotently. Evidence: [security-repro-parent.json](security-repro-parent.json). Full line-anchored reasoning and acceptance in specialist reports.

### SEC-04 P2 Price crawler reads menu paths denied by robots

Confirmed source-executed with transport doubles. Source: `scripts/harvest/uk-prices/run.mjs:392`. Homepage robots permission is reused for discovered menu paths instead of checking each path.

Remedy: Recheck source policy and robots for each target and redirect. Evidence: [security-harvest-repro-parent.json](security-harvest-repro-parent.json). Full line-anchored reasoning and acceptance in specialist reports.

### Q-03 P2 Then-vs-Now compares different drinks

Confirmed source-executed/static. Source: `lib/thenVsNow.ts:79`. Venue identity alone is insufficient to call a change in serving or drink a price rise or fall.

Remedy: Compare matching drink/serving only, or show separate observations without a delta. Evidence: [non-pint-proof.json](non-pint-proof.json). Full line-anchored reasoning and acceptance in specialist reports.

### Q-05 P2 Expired plan drafts reappear through legacy mirrors

Confirmed source-executed. Source: `lib/planDraft.ts`. V2 expiry falls through to timeless V1 data. Yesterday’s start time can defeat a fresh intake.

Remedy: Retire or migrate mirrors atomically; expired records cannot participate in arbitration. Evidence: [quality-proofs-parent.json](quality-proofs-parent.json). Full line-anchored reasoning and acceptance in specialist reports.

### Q-06 P2 Native Back skips document-bound picker dismissal

Confirmed event-seam proof; device untested. Source: `lib/nativeBackGesture.ts`. A window-dispatched Escape never reaches document-bound picker handlers, so history navigation can run.

Remedy: Use one dismissal contract and verify actual Android Back and iOS gesture behavior. Evidence: [quality-proofs-parent.json](quality-proofs-parent.json). Full line-anchored reasoning and acceptance in specialist reports.

### Q-08 P2 Native Back can request history twice

Confirmed hook/helper proof; device untested. Source: `components/map/pubmap/useMapKeyboardShortcuts.ts:46`. The Escape handler calls surface navigation but does not prevent default; native helper requests history again. Browser coalescing untested.

Remedy: Claim handled events and assert one dismissal or navigation per event. Evidence: [quality-extra-proofs-parent.json](quality-extra-proofs-parent.json). Full line-anchored reasoning and acceptance in specialist reports.

### Q-09 P2 Restricted storage crashes map persistence

Confirmed mounted-hook proof. Source: `components/map/pubmap/useBuiltIdsPersistence.ts:11`. Unconditional localStorage access throws SecurityError even with no planned stops.

Remedy: Use existing safeStorage boundary and preserve in-memory operation. Evidence: [quality-extra-proofs-parent.json](quality-extra-proofs-parent.json). Full line-anchored reasoning and acceptance in specialist reports.

### H9 P2 Committed lockfile contains conflict markers

Confirmed parser failure; npm install passed. Source: `package-lock.json:44`. Strict JSON readers fail. npm 11 accepts conflict JSON; observed concrete dependencies installed as expected.

Remedy: Regenerate under declared toolchain, validate JSON and compare clean resolutions. Evidence: [history.md](history.md). Full line-anchored reasoning and acceptance in specialist reports.

### OPS-01 P2 Freshness gate fails for area news

Confirmed local gate. Source: `data/area_news.json`. Area news exceeded 504 hours; three durable datasets could not be measured without configured services.

Remedy: Restore authorized producer ownership and verify durable freshness in an isolated configured environment. Evidence: [freshness.log](freshness.log). Full line-anchored reasoning and acceptance in specialist reports.

### Q-04 P2 Idle Discover has no deal-expiry rerender

Confirmed mounted-component clock proof. Source: `components/discovery/DealsTonightLane.tsx:98`. Clock is read only during renders, so crossing the end time need not remove an idle card.

Remedy: Schedule next boundary and refresh on visibility; validate mounted timed behavior. Evidence: [quality-deal-expiry-parent.json](quality-deal-expiry-parent.json). Full line-anchored reasoning and acceptance in specialist reports.

### UX-01 P3 Implementation labels leak into product copy

Confirmed browser. Source: `components/discovery/TonightMapPointer.tsx:23`. “/api/whats-on spine” and “Sort My Night P1” describe internal implementation rather than user outcomes.

Remedy: Replace with purpose-led copy. Evidence: [parent-findings.json](parent-findings.json). Full line-anchored reasoning and acceptance in specialist reports.

## Checks

- **Data validation: PASS**. 21 datasets accepted by documented validation.
- **Lint: PASS with warnings**. 0 errors; 72 warnings. Not a clean-warning claim.
- **Typecheck / deadcode: PASS**. Both passed within verify.
- **Full verify: FAIL**. 1620 files passed, 2 failed, 1 skipped. 17305 tests passed, 1 failed, 63 skipped. RLS setup timed out; deploy-size fence saw audit artifacts. Gate was not green.
- **Serial PostgreSQL / RLS: PASS on serial rerun**. 34 suites and 407 tests passed with one worker against disposable local PostgreSQL. Initial concurrent verify timed out in RLS setup; no production database tested.
- **Production build: PASS**. Two isolated E2E builds succeeded, keyed-test and keyless configurations. No deployment performed.
- **Full E2E: RUNNING**. 1174 cases inventoried. Failure contexts exist; final counts and isolated triage pending.
- **Freshness: FAIL**. 1 stale; 3 unresolved of 27 datasets. See freshness.log.
- **Dependency audit: PASS high/critical gate**. 0 high/critical; 3 moderate entries in one uuid tooling chain. Reachable application exploit not demonstrated.
- **Image outputs: PASS decode only**. 2573 image files decoded, 2406 unique pixel payloads, no decode failures. Not semantic visual review.
- **Native runtime / real auth provider: UNTESTED / BLOCKED**. No booted simulator or Android device tested; no isolated provider credentials. Browser and mocked tests do not establish native or real-provider correctness.
- **Deploy-size fence isolated rerun: PASS**. 3 tests passed after moving audit artifacts outside deploy input. Confirms initial failure was introduced by audit output, not pinned source.

## Recovery decisions

- Review current tracked files and historical losses, not every historical file version
- Complete London outings; browse occasions plus ask
- Local writes and read-only production
- Up to three bounded reviewers
- Date night: evidence-backed shortlist before asking
- Dancing: sourced pub + club/event + getting home
- Restore useful outcomes in current design
- Then-vs-Now: compare matching drinks and servings only; otherwise show observations without delta
- Atmosphere: labelled editorial estimates alongside sourced facts; unknown is not observed quiet
- Recover all outing types: dates, friends/dancing, quiet/gardens; up to three bounded reviewers
- 22 September: user explicitly authorized fixing findings and restoring all London outing journeys through Lavish feedback

Two actual deletions traced: TonightAgentPanel 942f7a25f -> da334c310 was superseded by one composer; do not revive duplicate UI. Night-out places f32a43454/f804e1a3e -> ab7330827 was removed in release-trust cleanup; exact rationale unresolved. Reuse nightOutPlaceContract/lateFood only if needed for the approved complete-evening outcome. Dancing was partial, not established as a deleted complete feature. See history.md for all commit references.

## Ordered roadmap

### 1. Close privacy, access and price correctness gaps

Depends: None. SEC-01/02/03/04, Q-07, Q-02/03, H9. Preserve public avatars, free drinker access and honest prices.

Acceptance: Old cover URL denied after privacy changes; server expiry enforced; client duration cannot erase use; per-path crawl permissions respected; true/false/unknown access facets hold; half/noncomparable drinks excluded from pint/change claims; clean strict lockfile.

### 2. Repair current journeys before adding scope

Depends: 1; isolate E2E failures. Date-night routing, music response admission, draft expiry, storage fallback and native Back ownership. Resolve freshness owner and prove timed deals.

Acceptance: Every shipped occasion chip completes keyless and provider-failure paths; music fixture renders; expired V1 cannot resurrect; map works with denied storage; one native Back action; empty/stale/failed states stay usable.

### 3. Recover browse-first London occasions

Depends: 1–2; labelled editorial estimates approved. Expose dates, friends, music, quiet, gardens and crawls in current design. Reuse existing routes and preferences, preserve area/date/group intent into Ask.

Acceptance: Person discovers a sourced shortlist, distinguishes sourced facts from labelled editorial estimates, understands unknowns, refines it, plans and shares without login friction or fabricated attributes. Desktop and 390px verified; no duplicated composer.

### 4. Build the complete dancing evening

Depends: 3; licensed/allowed club and event supply. Unify dancing/disco/DJ vocabulary across browse and Ask. Combine pub + sourced event + getting home; reuse late-food contract where needed.

Acceptance: Equivalent browse/ask constraints produce same dated evidence; cancelled/unmatched/empty listings handled; no pub-pint totals assigned to club/food stops; transport has source/time and fallback.

### 5. Make subsequent work auditable

Depends: Behavioral baselines from 1–4. Extend existing PLG_STRATEGY waves; reconcile roadmap statuses and harness precedence. Refactor map state ownership only behind transition tests; finish unresolved file and authenticated/native coverage.

Acceptance: One owner/status record per commitment with shipped SHA, source evidence and retirement rationale; CI proves user outcomes, not source-string presence alone; venue-first revenue and free Year in Pints preserved.

## Coverage still owed

- Finish semantic inspection of screened-only files and generated-output provenance, prioritizing reachable code, workflows, generators and native configuration.
- Validate real-provider account, messaging, upload/moderation, deletion and private relationship journeys against disposable configured services.
- Execute native Back/permission/deep-link/offline flows on iOS and Android.
- Reconcile full E2E results and repeat failures in isolation; do not convert mock success into deployed-service proof.
- Verify live dataset supply and operational controls through authorized read-only service access.
- Review remaining history and unmerged work separately. Eight open PRs captured, none treated as deployed fixes.

Full evidence: quality.md, security.md, history.md, browser-matrix.json, feature-inventory.json, file-ledger.json and test logs.
