# Weekend Audit Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with test-driven checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix confirmed weekend audit security, privacy, product, accessibility, performance, and build findings without weakening authentication or privacy controls.

**Architecture:** Keep authorization decisions in their existing domain modules. Add narrow seams where a request must be re-authorized or where a serverless side effect needs a completion boundary. Use pure policy modules for URL validation, wanted visibility, and public disclosure, then test route behavior against those policies.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase, Vitest, Playwright, npm lockfile, CycloneDX, OSV, Semgrep, Gitleaks.

## Global Constraints

- Do not deploy, mutate production data, push, or open a pull request.
- Reproduce each finding end to end and write its failing regression test before implementation.
- Preserve fail-closed authentication, authorization, RLS, CSP, rate limits, CSRF protection, and privacy wording.
- Do not log secrets, refresh tokens, signed URLs, private media, or user data.
- Use only first-party or licensed public/oEmbed metadata for wanted URL resolution.
- Do not fabricate freshness timestamps or data rows.
- Keep `PublicProfile` as the public projection and keep private identity fields out of legal-page examples.
- Run verification locally, use safe passive checks against production only, and use isolated local tests for active behavior.

---

### Task 1: Record baseline and failure evidence

**Files:**
- Create: `docs/superpowers/plans/2026-08-10-weekend-audit-repair.md`
- Inspect: `CONTEXT.md`, `AGENTS.md`, `.agents/skills/*`, `/tmp/pubmax-audit-20260810/*`

**Interfaces:**
- Produces: a current baseline, exact environment blockers, and a list of tests that reproduce each confirmed defect.

- [ ] **Step 1: Confirm repository state.** Run `git fetch origin main`, verify `HEAD` equals `origin/main`, verify the worktree is clean, and keep work on `codex/weekend-audit-repair-20260810`.
- [ ] **Step 2: Run baseline checks.** Run `npm ci`, `npm run validate-data`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run coverage`, and the available RLS, E2E, build, dependency, SAST, secret, and SBOM checks. Record exact exit codes and blockers without copying sensitive output.
- [ ] **Step 3: Inspect current GitHub evidence.** Use `~/.vite-plus/bin/gh-axi run list` and the newest failed run's job logs. Compare failures with this branch before treating them as defects.
- [ ] **Step 4: Commit only the plan if no source changes exist.** Use `git add docs/superpowers/plans/2026-08-10-weekend-audit-repair.md && git commit -m "docs: plan weekend audit repair"`.

### Task 2: Align legal disclosure with actual data paths

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `app/terms/page.tsx`
- Test: `__tests__/legalPages.test.ts`
- Test: `__tests__/privacyPolicy.test.ts` when its existing assertions cover the changed text

**Interfaces:**
- Consumes: `lib/socialLaunch.ts`, `lib/deviceAccountSessions.ts`, `lib/profiles.ts`, and image moderation routes.
- Produces: legal copy that names DOB-or-recorded-assertion Social access, the five-account local device lane, public profile fields, and all OpenAI image-processing surfaces.

- [ ] **Step 1: Add failing legal assertions.** Assert that Privacy and Terms mention Social/profile, message, and venue-wall image processing; DOB or one-tap adult self-assertion; local storage of up to five account records with refresh-token, email, handle, and activity metadata, its purpose/retention/removal; and public favourite drink, interests, and workplace. Assert stale DOB-only and one-browser-session wording is absent.
- [ ] **Step 2: Run the focused legal tests.** Run `npx vitest run __tests__/legalPages.test.ts __tests__/privacyPolicy.test.ts`; confirm failure on missing or stale wording.
- [ ] **Step 3: Update copy.** State that a stored DOB decides when present, otherwise one recorded self-assertion can satisfy the adult gate, and under-18 or invalid DOB still refuses access. Describe local device records as session-management data retained until sign-out/removal/eviction, with explicit account-control removal. Name all three public fields and all four signed-image processing surfaces. Keep no supporting copy below headings unless it prevents legal misunderstanding.
- [ ] **Step 4: Re-run focused tests and inspect rendered text.** Run the same Vitest command and verify no private identity field was added to public disclosure examples.
- [ ] **Step 5: Commit.** Use `git add app/privacy/page.tsx app/terms/page.tsx __tests__/legalPages.test.ts __tests__/privacyPolicy.test.ts && git commit -m "fix: align privacy disclosures with product data paths"`.

### Task 3: Prevent cookie redemption on cross-site Social access and harden message opens

**Files:**
- Modify: `lib/socialAccessServer.ts`
- Modify: `app/api/social/access/route.ts`
- Modify: `app/api/messages/route.ts`
- Test: `__tests__/socialAccessRoute.test.ts` or the existing Social access route test
- Test: `__tests__/messagesRoute.test.ts` or the existing messages route test

**Interfaces:**
- Consumes: bearer verification, `pubmax_resume`, `profileStore`, `isLimited`, `gateHandleAction`, and `normalizeHandle`.
- Produces: `resolveSocialAccess(request, deps?, options?)` with an explicit no-resume-cookie GET path, and a fail-closed, recipient-validated message-open path.

- [ ] **Step 1: Reproduce the Social CSRF issue.** Add a test with an attacker `Origin`, only the resume cookie, and a mocked GoTrue refresh endpoint. Assert current GET redeems or attempts refresh and returns access. Run it and confirm failure of the desired no-redemption assertion.
- [ ] **Step 2: Reproduce unlimited nonexistent opens.** Add tests that open an unknown handle and two identifier variants, and a concurrent batch that exceeds the open budget. Assert no durable open rows are created, the recipient is rejected, and the limiter is consulted before `openConversation`. Run focused tests and confirm failure.
- [ ] **Step 3: Implement explicit verification options.** Keep bearer verification available for GET. Add a named option that disables resume-cookie redemption for GET. Do not rotate or persist a cookie from a GET fallback. Keep any legacy POST flow protected by its existing CSRF and durable limiter path.
- [ ] **Step 4: Add recipient validation.** Normalize the recipient handle, apply the open limiter before storage, read the recipient profile, and require a live claimed `userId` with no tombstone. Return a stable non-success response for absent/unclaimed recipients and a retryable 503 when the profile read or durable limiter cannot prove safety. Do not call `openConversation` before both checks pass.
- [ ] **Step 5: Run focused tests.** Run the Social access and messages route tests, including concurrency and mixed-case identifiers. Confirm the attacker-origin GET cannot consume the cookie and valid bearer access still works.
- [ ] **Step 6: Commit.** Use `git add lib/socialAccessServer.ts app/api/social/access/route.ts app/api/messages/route.ts __tests__ && git commit -m "fix: harden social access and message opening"`.

### Task 4: Make private Social media authorization revocable per request

**Files:**
- Modify: `app/api/social/media/[mediaId]/route.ts`
- Modify: `lib/socialPostMedia.server.ts` or the narrow storage reader it owns
- Test: `__tests__/socialMediaRoute.test.ts`

**Interfaces:**
- Consumes: `requireVerifiedSocialActor`, current consent/block/friend relationship checks, and the existing private object reader.
- Produces: an authorized `GET` that streams the private object with `Cache-Control: private, no-store`, without returning a reusable signed URL.

- [ ] **Step 1: Reproduce copied-URL persistence.** Add a route test that obtains the current redirect target, changes the relationship to blocked/unfriended, and requests the copied target. Assert the copied storage URL still succeeds under current code. Run it and confirm failure.
- [ ] **Step 2: Add a private streaming reader.** Read the object only after current actor, consent, relationship, and limiter checks. Return a bounded response body with content type from the existing media metadata. Do not include a `Location` header or a cacheable signed URL.
- [ ] **Step 3: Test revocation and headers.** Confirm a relationship change blocks the next route request, valid requests stream media, and all successful/error responses remain private and no-store.
- [ ] **Step 4: Commit.** Use `git add app/api/social/media/[mediaId]/route.ts lib/socialPostMedia.server.ts __tests__/socialMediaRoute.test.ts && git commit -m "fix: reauthorize private social media delivery"`.

### Task 5: Resolve dependency, CSP, auth-policy, and media-lifecycle findings

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `proxy.ts`
- Create or modify: a browser-safe refresh-token policy module and its tests
- Modify: focused profile, venue, and message media lifecycle modules only when tests prove identical behavior
- Test: dependency, CSP, refresh-token, and media lifecycle tests

**Interfaces:**
- Consumes: posthog-js dependency tree, route CSP policy, existing `isPlausibleRefreshToken`, and the three media upload lifecycles.
- Produces: patched DOMPurify advisory, route-scoped CSP without unnecessary `unsafe-inline`, one refresh-token plausibility policy, and no unsafe lifecycle duplication.

- [ ] **Step 1: Add failing dependency/CSP tests.** Assert the lockfile resolves a DOMPurify version outside GHSA-55q2-fjhq-7xh7's affected range and assert only the documented `/` and `/map` routes retain `unsafe-inline`; Social and other nonce routes must not.
- [ ] **Step 2: Update the dependency.** Upgrade `posthog-js` or add the smallest safe override that produces a patched transitive DOMPurify version. Run `npm install --package-lock-only` or the repository-approved lockfile command, then inspect `npm ls dompurify posthog-js`.
- [ ] **Step 3: Tighten CSP.** Remove `unsafe-inline` from routes that already have a nonce path. Keep only the documented tightly scoped exceptions and add tests for Next rendering, nonce scripts, and public map behavior.
- [ ] **Step 4: Deduplicate pure token plausibility.** Extract only the environment-independent token shape predicate. Keep cookie persistence, rotation, and browser storage policies in their owners. Add equivalent browser and server tests.
- [ ] **Step 5: Compare media lifecycles.** Use existing journey tests to identify only identical validation/storage/promotion mechanics. If policy differs, leave code separate and document why. Do not add a generic authorization abstraction.
- [ ] **Step 6: Run focused security tests and commit.** Run dependency, CSP, auth-session, and media tests, then commit with `git add package.json package-lock.json proxy.ts lib __tests__ && git commit -m "fix: constrain dependency and request security surfaces"`.

### Task 6: Implement wanted URL resolution and privacy/actions vertical slice

**Files:**
- Modify: `lib/wantedResolve.server.ts`
- Modify: `lib/wanted.ts`
- Modify: wanted API routes and components identified by existing tests
- Test: `__tests__/wantedResolve.test.ts`, `__tests__/wanted.test.ts`, and route/component tests

**Interfaces:**
- Consumes: PRD `docs/prd/SOCIAL_NIGHT_OS_VISION_PRD.md`, existing wanted store/routes, and crew membership policy.
- Produces: safe Reel/TikTok/YouTube metadata candidates; optional drink interest; `private`, `mutuals`, and `crew:<id>` visibility; Crew and Soft Plan actions with owner/relationship checks.

- [ ] **Step 1: Write failing resolution tests.** Cover supported canonical hosts, redirects that leave the allowlist, private-network destinations, oversized bodies, timeout, malformed oEmbed JSON, and safe title/thumbnail extraction. Assert no fetch for unsupported hosts.
- [ ] **Step 2: Implement bounded allowlisted resolution.** Parse URLs, allow only documented platform hosts and HTTPS, reject credentials/ports/private IP literals, resolve DNS safely where required by the existing SSRF helper, apply timeout and response/body limits, and parse only the documented oEmbed/public metadata fields. Never log source URLs containing tokens.
- [ ] **Step 3: Write failing wanted policy tests.** Cover optional drink interest, each visibility value, owner-only edits/deletes, mutual visibility, crew membership, Crew action, Soft Plan action, and rejection of forged crew ids or foreign owners.
- [ ] **Step 4: Implement the vertical slice.** Keep visibility policy pure and call it from reads and mutations. Validate all identifiers server-side, enforce ownership before actions, and keep private items out of public projections.
- [ ] **Step 5: Run focused tests and commit.** Run wanted resolver, store, route, and UI tests, then commit with `git add lib/wanted* app/api app/social __tests__ && git commit -m "feat: add safe wanted resolution and privacy actions"`.

### Task 7: Fix map, mobile, Social rail, accessibility, tokens, telemetry, manifest, freshness, and OG edge behavior

**Files:**
- Modify: `components/map/MapPriceControl.tsx` and related map styles/tests
- Modify: `app/api/map-search/route.ts`
- Modify: `public/manifest.webmanifest`
- Modify: `components/social/peopleDirectory.css` or its actual owning stylesheet
- Modify: `components/city/CityChooser.tsx`, `components/landing/LandingPage.tsx`, `components/landing/ThamesHero.tsx`
- Modify: `app/social/social.css`, `components/a11y/skipLink.css`, semantic token source
- Modify: mobile Plan/Social/map components and affected tests
- Modify: `app/og.png/route.tsx`, `lib/ogBrand.tsx`, or a server-safe OG brand module
- Modify: freshness config/code only where investigation proves a defect
- Test: affected unit/component/E2E tests and data-validation tests

**Interfaces:**
- Consumes: landing plan, map density constants, existing telemetry store, container dimensions, accessibility contracts, and edge-runtime constraints.
- Produces: responsive controls, one-column narrow Social rail at desktop, valid accessible names/controls, semantic tokens, awaited or completion-bound telemetry, canonical manifest metadata, truthful freshness reporting, and edge-safe OG output.

- [ ] **Step 1: Add failing UI and build tests.** Assert mobile MapPriceControl renders and auto-collapses, 320px map chips do not clip, signed-out Social exposes a useful sign-in path, Plan first screen does not clip, narrow Social rail stays readable at 1440, ARIA ids/names match, manifest name is `PUBMAXX`, telemetry completion is observed, and OG import graph has no `fs`, `path`, or `process.cwd` in the edge route.
- [ ] **Step 2: Implement responsive and accessible behavior.** Use container-aware rail rules or one column below the rail threshold, preserve concise labels, fix exact `aria-controls` targets and accessible names, and remove clipping without adding repeated helper copy.
- [ ] **Step 3: Add mobile map path and auto-collapse.** Keep desktop interaction unchanged, expose the mobile control path, and collapse after selection or outside interaction according to the plan.
- [ ] **Step 4: Replace one-off tokens.** Map Social z-index and skip-link colors to existing semantic tokens. Add token assertions so raw one-off values do not return.
- [ ] **Step 5: Bound telemetry completion.** Use Next's supported `after`/completion mechanism when available, or await the insert only within a bounded timeout. Preserve fast response, swallow/log no user data on telemetry failure, and add a test that observes completion and failure isolation.
- [ ] **Step 6: Fix manifest and edge OG imports.** Use canonical product metadata. Move only static OG constants into a server-safe module or inline them without changing valid image output.
- [ ] **Step 7: Investigate feeds.** Trace each stale and unresolved feed to its source, config, or scheduled path. Fix only confirmed code/config defects. Keep a truthful skip/unresolved state when the provider or permission is unavailable.
- [ ] **Step 8: Run focused UI/build/data tests and commit.** Use Playwright at 1440, 320, 390, and 430 widths where available, then commit coherent changes.

### Task 8: Full verification, safe security sweep, review, and handoff

**Files:**
- Modify: only files required by verification findings
- Generate outside source: CycloneDX production and full SBOM artifacts under `/tmp/pubmax-audit-20260810/final/`

**Interfaces:**
- Consumes: all completed task commits and current local environment.
- Produces: clean local branch, exact verification evidence, independent review findings, and final fixed/verified/blocked/deferred report.

- [ ] **Step 1: Run required checks.** Run `npm ci`, `npm run validate-data`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run coverage`, `npm run test:rls` when prerequisites exist, `npm run test:e2e` with Chromium, and an isolated build with `NEXT_DIST_DIR=.next-prod`.
- [ ] **Step 2: Run security scans.** Run `npm audit`, `scripts/resilient-audit.mjs`, OSV, Semgrep or equivalent SAST, Gitleaks on current tree and branch history, dependency inspection, and secret-safe static searches. Report pre-existing unrelated findings separately.
- [ ] **Step 3: Generate SBOMs.** Generate CycloneDX production and full SBOM files outside committed source, inspect component counts and vulnerability metadata, and do not include secrets.
- [ ] **Step 4: Run safe local load tests.** Use a bounded ramp against local routes, document limiter status codes and latency, and stop before resource exhaustion. Do not stress production.
- [ ] **Step 5: Perform browser review.** Read the browser anti-stall protocol first, start the app locally, review affected pages at desktop and mobile sizes, and capture only non-sensitive UI evidence.
- [ ] **Step 6: Perform independent review.** Review the final diff against repository standards, all 24 findings, referenced PRD/plan, auth ownership, media revocation, cookies/CSRF, SSRF, XSS, SQL/RLS, cache privacy, and logs. Fix confirmed findings with a fresh failing test.
- [ ] **Step 7: Commit verification fixes and confirm clean branch.** Run `git status --short`, `git log --oneline`, and repeat targeted checks after any final fix. Do not push or open a PR.
- [ ] **Step 8: Report.** Include fixed, verified, blocked, and deferred items; commit hashes; exact commands; test counts; blockers; remaining risks; and absolute file links.
