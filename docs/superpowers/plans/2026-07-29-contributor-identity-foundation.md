# Contributor Identity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind contribution handles to authenticated accounts, add adult contribution eligibility, and require that identity for community price and venue-signal writes.

**Architecture:** Keep public identity in the existing immutable `profiles.id` plus account-owned handle model. Store private signup details and only derived age eligibility in a separate server-only table keyed by Supabase Auth user id. A global one-screen onboarding surface claims the handle after an explicit availability check, while a reusable contribution gate asks for date of birth only before the first gated community price or venue-signal contribution.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth and Postgres, Vitest.

## Global Constraints

- Sign-in is required for contribution writes. Browsing and reporting existing observations stay available signed out.
- Google, Apple, and magic link are the supported sign-in paths. Provider buttons remain conditional on live Supabase settings.
- `karan`, `sarah`, `carol`, and `erin` are unclaimable through one named code list.
- Handle availability, taken, reserved, and invalid states are distinguishable before submit.
- Raw date of birth is never stored. Keep only an adult gate result or the date an under-18 becomes eligible.
- Public surfaces expose handle only. Full name, sex, account id, and age-gate state stay private.
- One onboarding screen at 390px. Handle first. Full name and sex optional. One-tap skip for optional fields.
- Scope ends after the identity foundation and community price/venue-signal boundary. Visit Reports and Recommendations remain an explicit follow-up.
- No unrelated dependency, audit, or analytics privacy work.

---

### Task 1: Identity and age policy

**Files:**
- Modify: `lib/pubmaxxIdentity.ts`
- Create: `lib/contributionEligibility.ts`
- Modify: `CONTEXT.md`
- Test: `__tests__/contributorIdentityPolicy.test.ts`

**Interfaces:**
- Produces: `RESERVED_CONTRIBUTOR_HANDLES`, existing `assessPubmaxxHandle`, `assessContributionAge(dateOfBirth, now?)`, and `ContributionAgeAssessment`.
- Consumes: existing handle normalization and Europe/London calendar dates.

- [ ] **Step 1: Write failing policy tests**

Test exact captain-reserved names as `reserved`, a nearby unreserved name as valid, the day before and day of an eighteenth birthday, malformed and future dates, and the derived `eligibleOn` value for an under-18.

- [ ] **Step 2: Run test and verify policy gaps**

Run: `npm test -- __tests__/contributorIdentityPolicy.test.ts`

Expected: failures because captain-reserved handles and age policy do not exist.

- [ ] **Step 3: Implement pure policy**

Export the four-name reserved list from `lib/pubmaxxIdentity.ts` and consult it from `assessPubmaxxHandle`. Implement strict `YYYY-MM-DD` parsing and Europe/London calendar-age comparison in `lib/contributionEligibility.ts`. Never return or persist date of birth beyond the pure assessment call.

- [ ] **Step 4: Update domain language**

Replace the obsolete self-declared Contributor Handle definition in `CONTEXT.md` with an account-bound public name attached to immutable PUBMAXX User ID. Add Contribution Eligibility as a private, derived adult gate.

- [ ] **Step 5: Run test green**

Run: `npm test -- __tests__/contributorIdentityPolicy.test.ts`

Expected: all policy cases pass.

### Task 2: Private identity storage and claim transfer

**Files:**
- Create: `lib/privateIdentityStore.ts`
- Create: `supabase/migrations/20260729120000_0061_contributor_identity.sql`
- Test: `__tests__/privateIdentityStore.test.ts`
- Modify: `__tests__/pubmaxxIdentityRoutes.test.ts`

**Interfaces:**
- Produces: `PrivateIdentityRecord`, `privateIdentityStore().read`, `completeOnboarding`, `recordAgeAssessment`, and `contributionGate`.
- Consumes: `identityHandleStore().claim`, `profileStore`, and `assessContributionAge`.

- [ ] **Step 1: Write failing memory-store tests**

Test one account claiming an unused handle, claiming a pre-existing unlinked profile, first claimant winning, optional private fields staying out of `ProfileRecord`, adult verification without raw birth date, and under-18 storage containing only `contributionEligibleOn`.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- __tests__/privateIdentityStore.test.ts __tests__/pubmaxxIdentityRoutes.test.ts`

Expected: missing store and legacy profile availability incorrectly reported as taken.

- [ ] **Step 3: Implement memory and Supabase store**

Keep the memory map keyed by verified auth user id. Durable reads and writes target `private_account_identities`, which has no public grants. Normalize full name to 100 characters and accept only the closed optional sex vocabulary. Contribution gate returns `onboarding_required`, `age_required`, `underage`, or `eligible`.

- [ ] **Step 4: Add durable migration**

Create the private table with auth-user cascade, no public privileges, and mutually exclusive `adult_verified` and `contribution_eligible_on`. Replace `claim_pubmaxx_handle` so an unlinked legacy profile can be claimed before alias collision checks, while a linked profile still wins races. Keep past handle-keyed rows in place so linking the existing profile transfers them.

- [ ] **Step 5: Fix availability semantics**

An unlinked legacy profile is claimable and returns available. A linked profile or alias owned by another account is taken. Reserved validation returns before store lookup.

- [ ] **Step 6: Run tests green**

Run: `npm test -- __tests__/privateIdentityStore.test.ts __tests__/pubmaxxIdentityRoutes.test.ts`

Expected: reservation, first-to-verify claim, and derived age storage pass.

### Task 3: Onboarding and age APIs

**Files:**
- Create: `app/api/identity/onboarding/route.ts`
- Create: `app/api/identity/contribution-gate/route.ts`
- Test: `__tests__/identityOnboardingRoute.test.ts`
- Test: `__tests__/contributionGateRoute.test.ts`

**Interfaces:**
- Produces: authenticated GET/POST onboarding API and authenticated GET/POST contribution-gate API.
- Consumes: `callerUserId`, handle policy, private identity store, and age policy.

- [ ] **Step 1: Write failing route tests**

Test 401 without verified auth, GET incomplete state, reserved and taken distinctions, successful claim of an unlinked profile, private optional values, age-required state, adult verification, and plain under-18 response.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- __tests__/identityOnboardingRoute.test.ts __tests__/contributionGateRoute.test.ts`

Expected: route modules are missing.

- [ ] **Step 3: Implement routes**

Use `jsonNoStore`, verified bearer identity only, bounded request bodies, existing rate-limit seams, and server-owned timestamps. POST onboarding rejects any handle whose availability was not independently valid at the server. POST contribution gate accepts date of birth for assessment but passes only the derived result to storage.

- [ ] **Step 4: Run tests green**

Run: `npm test -- __tests__/identityOnboardingRoute.test.ts __tests__/contributionGateRoute.test.ts`

Expected: all route boundaries pass.

### Task 4: Google, Apple, and callback-safe sign-in

**Files:**
- Modify: `lib/authProviderAvailability.ts`
- Modify: `components/auth/AuthProvider.tsx`
- Modify: `components/auth/SocialSignInButtons.tsx`
- Modify: `components/auth/SignInButton.tsx`
- Modify: `components/identity/IdentityNudge.tsx`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `__tests__/authProviderAvailability.test.ts`
- Modify: `__tests__/analyticsEvents.test.ts`

**Interfaces:**
- Produces: `signInWithApple`, Apple capability detection from `external.apple`, and Supabase OAuth start with provider `apple`.
- Consumes: existing canonical callback preparation, PKCE exchange, provider recheck, and magic-link flow.

- [ ] **Step 1: Change provider tests first**

Expect Google and Apple capability flags, Apple fail-closed copy, and analytics provider enum `apple`. Remove Microsoft expectations from contribution-facing auth.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- __tests__/authProviderAvailability.test.ts __tests__/analyticsEvents.test.ts`

Expected: provider shapes still expose Microsoft.

- [ ] **Step 3: Implement Apple path**

Map live Supabase `external.apple`, call `signInWithOAuth({ provider: "apple", options: { redirectTo } })`, reuse canonical callback URL and PKCE exchange, and render Apple only when enabled. Keep magic link visible with zero enabled OAuth providers.

- [ ] **Step 4: Update deployment instructions**

Describe Google and Apple dashboard enablement, canonical allowlist, Supabase callback, and Apple paid Developer account dependency.

- [ ] **Step 5: Run tests green**

Run: `npm test -- __tests__/authProviderAvailability.test.ts __tests__/analyticsEvents.test.ts __tests__/authCallbackSafeNext.test.ts __tests__/authCallbackClient.test.ts`

Expected: provider gating and callback tests pass.

### Task 5: One-screen account onboarding

**Files:**
- Create: `components/identity/AccountOnboarding.tsx`
- Create: `components/identity/accountOnboarding.css`
- Modify: `components/auth/AuthProvider.tsx`
- Modify: `app/auth/auth.css`
- Test: `__tests__/accountOnboarding.test.tsx`

**Interfaces:**
- Produces: global signed-in onboarding dialog and `onComplete(handle)` callback.
- Consumes: onboarding API, `authedFetch`, account-bound handle event, and live auth session.

- [ ] **Step 1: Write failing component tests**

Test handle-first order, optional labels, skip-optional action, pre-submit availability requirement, distinct available/taken/reserved copy, submit disabled while unchecked, and 390px control/tap-target contract.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- __tests__/accountOnboarding.test.ts`

Expected: component missing.

- [ ] **Step 3: Implement compact dialog**

Load onboarding status after sign-in. Prefill a valid unreserved device handle only as a suggestion. Check availability after a short pause and on blur. Invalidate the check whenever text changes. Submit only the exact handle last checked as available. Keep optional fields collapsed behind plain labels and provide `Skip optional details` as one tap.

- [ ] **Step 4: Replace automatic email-handle claim**

Remove AuthProvider's email-derived quick claim and skippable Claim Night flow. A signed-in user has no context handle until `/api/identity/handle/current` returns an owned profile. Render onboarding when that read returns no profile.

- [ ] **Step 5: Run tests green**

Run: `npm test -- __tests__/accountOnboarding.test.ts __tests__/authSessionTransition.test.ts`

Expected: new onboarding behavior passes and auth restoration remains stable.

### Task 6: Reusable first-contribution age moment

**Files:**
- Create: `components/identity/ContributionGateDialog.tsx`
- Create: `components/identity/contributionGate.css`
- Create: `lib/contributionGateClient.ts`
- Test: `__tests__/contributionGateClient.test.ts`
- Test: `__tests__/contributionGateSurface.test.ts`

**Interfaces:**
- Produces: `ensureContributionEligible()` and dialog callback resolving `eligible` or `blocked`.
- Consumes: account onboarding status, contribution-gate API, and auth context.

- [ ] **Step 1: Write failing gate tests**

Test signed-out state, onboarding-needed state, date requested only when age is unknown, adult success, plain under-18 block, and no second date prompt after verification.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- __tests__/contributionGateClient.test.ts __tests__/contributionGateSurface.test.tsx`

Expected: client and surface missing.

- [ ] **Step 3: Implement gate**

Show sign-in choices when signed out, defer to account onboarding when handle is absent, then show one date field immediately before write. Under-18 copy says community price and venue-signal contribution are blocked because PUBMAXX is about buying alcohol. Never echo date of birth back from server. Visit Reports and Recommendations remain outside this staged boundary.

- [ ] **Step 4: Run tests green**

Run: `npm test -- __tests__/contributionGateClient.test.ts __tests__/contributionGateSurface.test.ts`

Expected: gate behavior passes.

### Task 7: Require identity on community price and venue-signal writes

**Files:**
- Modify: `app/api/price-submit/route.ts`
- Modify: `components/map/useCommunityPrices.ts`
- Modify: `components/map/VenuePriceSubmit.tsx`
- Modify: `components/map/VenueCommunitySignals.tsx`
- Modify: `lib/analyticsEvents.ts`
- Modify: `__tests__/priceSubmitRoute.test.ts`
- Modify: `__tests__/analyticsEvents.test.ts`
- Modify: `__tests__/communityPriceClientState.test.ts`

**Interfaces:**
- Produces: authenticated, profile-owned, adult-eligible price/signal writes with server-derived handle.
- Consumes: `callerUserId`, `profileStore.getByUserId`, private contribution gate, and reusable gate surface.

- [ ] **Step 1: Rewrite route tests first**

Replace anonymous-write expectations with 401 `sign_in_required`, 409 `onboarding_required`, 403 `age_required`, and successful server-derived attribution. Prove a body-supplied handle is ignored. Apply the same boundary to venue signals.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- __tests__/priceSubmitRoute.test.ts`

Expected: anonymous writes still succeed.

- [ ] **Step 3: Implement server boundary**

Leave the reader-report branch outside contribution gating. Before price or venue-signal validation, require verified account, owned profile, and adult eligibility. Use profile handle and account-derived actor server-side; ignore contributor identity fields in the body.

- [ ] **Step 4: Implement client journey and funnel events**

Price and signal submit buttons invoke the reusable gate before POST. Track fixed-enum, identity-free events for gate viewed, sign-in required, onboarding required, age requested, under-age blocked, and write resumed. Remove anonymous contribution copy.

- [ ] **Step 5: Run focused tests green**

Run: `npm test -- __tests__/priceSubmitRoute.test.ts __tests__/communityPriceClientState.test.ts __tests__/analyticsEvents.test.ts`

Expected: required-sign-in and funnel coverage pass.

### Task 8: Privacy accuracy, visual QA, and closeout

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `__tests__/legalPages.test.ts`
- Modify: `docs/superpowers/plans/2026-07-29-contributor-identity-foundation.md`

**Interfaces:**
- Consumes: shipped storage behavior and public/private boundaries from Tasks 1 through 7.
- Produces: accurate notice and verified 390px journey.

- [ ] **Step 1: Update identity paragraph only**

State that sign-in supports magic link, Google, and Apple; handle is public; full name and sex are private; raw date of birth is assessed but not retained; retained gate data is an adult-verification boolean or eighteenth-birthday eligibility date and why. Correct community price and venue-signal paragraphs from anonymous to account-bound.

- [ ] **Step 2: Run legal tests**

Run: `npm test -- __tests__/legalPages.test.ts`

Expected: privacy accuracy checks pass without weakening unrelated analytics assertions.

- [ ] **Step 3: Run focused and full verification**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run verify`

Expected: exit 0 for every command.

- [ ] **Step 4: Exercise 390px journey**

Run keyless app, open map at a selected pub, emulate `390x844x3,mobile,touch`, and inspect sign-in, onboarding, availability, and date gate. Fix any clipping, tap target below 44px, hidden required state, or trust copy truncation.

- [ ] **Step 5: Record scoped follow-up**

In final status and PR body, state Visit Reports and Recommendations still accept legacy displayed names and require the same account/profile/adult retrofit. State Apple requires captain dashboard enablement plus a paid Apple Developer account. State exact retained age data.

- [ ] **Step 6: Commit**

Run: `git add` for identity-scoped files, then `git commit -m "feat: bind contributions to account identity"`.

Expected: clean identity-scoped commit on `fm/contributor-identity`.
