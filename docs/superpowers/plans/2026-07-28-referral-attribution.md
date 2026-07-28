# Referral Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record private referral journeys and immutable account edges, qualify them only through a future authenticated contribution seam, and append blocked milestone rewards without granting pro access.

**Architecture:** A first-touch, opaque HttpOnly cookie points to a server-side attribution journey, so no account identity travels in the browser. A dual memory/Supabase store owns invite codes, journeys, immutable edges, qualification events, and append-only reward events. Milestone evaluation records earned feature events at 1, 3, and 5 qualified referrals, while a compile-time closed grant gate ensures no entitlement is returned or granted before contributor identity and person-level anti-self-referral checks exist.

**Tech Stack:** Next.js 16 route handlers, React 19, TypeScript, Supabase/PostgreSQL, Vitest, existing CSS.

## Global Constraints

- No new dependency, email sending, external growth tooling, points, currency, paid virality, forced virality, leaderboard referral data, or public invite edges.
- Invite edges are private, recorded once, immutable, and reject same-account and direct circular referrals.
- Qualification requires completed signup plus one accepted contribution bound to authenticated identity.
- Milestones are 1, 3, and 5 qualified referrals. Future grants are permanent.
- Granting remains disabled until authenticated contribution identity and person-level anti-self-referral checks exist.
- Attribution has a 30-day first-touch browser journey. Cookie clearing, blocked cookies, another browser/device, and expiry are explicit failure modes.
- Product copy follows `docs/VOICE.md`, has no em dash or exclamation mark, and does not nag.
- Privacy and terms change with the data path.
- Mobile UI keeps 44px tap targets, reflows at 390px, and adds no motion.

---

### Task 1: Referral domain and persistence contract

**Files:**
- Create: `lib/referrals.ts`
- Create: `lib/referralStore.ts`
- Create: `supabase/migrations/20260728143000_0060_referrals.sql`
- Test: `__tests__/referrals.test.ts`
- Test: `__tests__/referralStore.test.ts`

**Interfaces:**
- Produces: `REFERRAL_MILESTONES`, `REFERRAL_GRANT_GATE`, `referralFeatureForMilestone`, `ReferralStore`, `referralStore`, and `memoryReferralStore`.
- Produces: invite creation, journey start/resolve, immutable edge recording, future qualification, private status reads, and test-only memory reset.

- [ ] **Step 1: Write failing domain tests**

```ts
expect(REFERRAL_MILESTONES).toEqual([1, 3, 5]);
expect(REFERRAL_GRANT_GATE.enabled).toBe(false);
expect(referralFeatureForMilestone(1)).toBe("collaborative_night_credit");
```

- [ ] **Step 2: Run domain tests and confirm missing-module failure**

Run: `npm test -- __tests__/referrals.test.ts`

Expected: FAIL because `@/lib/referrals` does not exist.

- [ ] **Step 3: Implement domain constants and types**

```ts
export const REFERRAL_MILESTONES = [1, 3, 5] as const;
export const REFERRAL_GRANT_GATE = {
  enabled: false,
  blockers: ["authenticated_contribution_identity", "person_level_self_referral_check"],
} as const;
```

- [ ] **Step 4: Run domain tests**

Run: `npm test -- __tests__/referrals.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing store behavior tests**

```ts
expect(await store.recordEdge({ inviterUserId: "a", inviteeUserId: "a" })).toMatchObject({ ok: false, reason: "self" });
await store.recordEdge({ inviterUserId: "a", inviteeUserId: "b" });
expect(await store.recordEdge({ inviterUserId: "b", inviteeUserId: "a" })).toMatchObject({ ok: false, reason: "circular" });
```

Cover first-touch journeys, expired journeys, signup-before-click rejection, one immutable inviter per invitee, first accepted contribution only, 1/3/5 earned ledger events, no feature grants, and private aggregate status.

- [ ] **Step 6: Run store tests and confirm missing behavior**

Run: `npm test -- __tests__/referralStore.test.ts`

Expected: FAIL because store API does not exist.

- [ ] **Step 7: Implement memory and Supabase stores**

Use opaque random tokens, SHA-256 hashes for browser journey tokens at rest,
bounded process memory, Supabase RPCs for atomic edge and qualification checks,
and `selectStore` for keyless fallback. Keep the reusable invite token private
so the same account link can be returned. Store qualification and milestone
events append-only. Do not expose raw account IDs outside store methods.

- [ ] **Step 8: Add migration**

Create private `referral_invite_codes`, `referral_attribution_journeys`, `referral_edges`, `referral_qualification_events`, and `pro_feature_unlock_ledger` tables. Revoke client access, enforce one inviter per invitee, block ordinary edge/qualification/ledger updates and deletes, and provide service-role RPCs that reject self/circular edges and append earned milestone events without feature grants.

- [ ] **Step 9: Run store tests**

Run: `npm test -- __tests__/referralStore.test.ts __tests__/referrals.test.ts`

Expected: PASS.

### Task 2: Delayed attribution and private APIs

**Files:**
- Create: `app/r/[code]/route.ts`
- Create: `app/api/referrals/invite-link/route.ts`
- Create: `app/api/referrals/claim-attribution/route.ts`
- Create: `app/api/referrals/status/route.ts`
- Modify: `lib/authServer.ts`
- Modify: `components/auth/AuthProvider.tsx`
- Test: `__tests__/referralRoutes.test.ts`

**Interfaces:**
- Consumes: referral store from Task 1 and verified `callerAuthIdentity`.
- Produces: a public invite redirect, authenticated invite-link/status APIs, and silent post-signup attribution claim.

- [ ] **Step 1: Write failing route tests**

Cover invalid invite redirects without a cookie, valid first-touch cookie retention, 30-day cookie attributes, authenticated invite link creation, anonymous API rejection, delayed signup claim, pre-existing account rejection, self/circle rejection, no-store responses, and identity-free status JSON.

- [ ] **Step 2: Run route tests and confirm missing-route failure**

Run: `npm test -- __tests__/referralRoutes.test.ts`

Expected: FAIL because referral routes do not exist.

- [ ] **Step 3: Implement route handlers**

Set `pubmaxx_referral_journey` as `HttpOnly`, `SameSite=Lax`, `Path=/`, 30-day max age, and `Secure` outside local HTTP. Claim using verified JWT user ID and account creation time only. Clear invalid, expired, or consumed journey cookies. Return only viewer-owned link and aggregate milestone status.

- [ ] **Step 4: Wire post-signup claim**

After Supabase session restoration or `SIGNED_IN`, call the claim endpoint through `authedFetch`. Treat it as fail-soft and never block auth or browsing.

- [ ] **Step 5: Run route and auth regression tests**

Run: `npm test -- __tests__/referralRoutes.test.ts __tests__/authCallbackSafeNext.test.ts __tests__/passwordlessAuth.test.ts`

Expected: PASS.

### Task 3: Findable, non-nagging account surface

**Files:**
- Modify: `components/profile/PubmaxxAccountHub.tsx`
- Modify: `app/u/[handle]/profile.css`
- Test: `__tests__/pubmaxxAccountHub.test.ts`
- Test: `__tests__/mobileChromeFit.test.ts`

**Interfaces:**
- Consumes: authenticated invite-link and status APIs from Task 2.
- Produces: one account-only referral card with copy/share action and pending milestone progress.

- [ ] **Step 1: Write failing UI tests**

Assert signed-out UI has no invite control, signed-in UI has one `Invite a mate` action, copy avoids banned terms and false grant claims, status names accepted contribution qualification, and API responses never render referrer/invitee identities.

- [ ] **Step 2: Run UI tests**

Run: `npm test -- __tests__/pubmaxxAccountHub.test.ts __tests__/mobileChromeFit.test.ts`

Expected: FAIL because invite card is absent.

- [ ] **Step 3: Implement account card and CSS**

Load referral status only inside signed-in account hub. Create link on deliberate button press, prefer native share, fall back to clipboard, and show a selectable link if neither works. Keep controls at least 44px and use one-column mobile reflow with no animation.

- [ ] **Step 4: Run UI tests**

Run: `npm test -- __tests__/pubmaxxAccountHub.test.ts __tests__/mobileChromeFit.test.ts`

Expected: PASS.

### Task 4: Legal truth and architecture fences

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `app/terms/page.tsx`
- Modify: `__tests__/legalPages.test.ts`
- Create: `docs/REFERRALS.md`

**Interfaces:**
- Consumes: actual cookie, retention, private edge, qualification, and disabled-grant behavior.
- Produces: reader-facing disclosure and PR-body-ready failure-mode documentation.

- [ ] **Step 1: Write failing legal tests**

Assert privacy names the private account edge, 30-day referral cookie, genuine attribution failures, contribution qualification, private visibility, and retention. Assert terms prohibit self/circular referrals and say rewards are not live while the identity gate is closed.

- [ ] **Step 2: Run legal tests**

Run: `npm test -- __tests__/legalPages.test.ts`

Expected: FAIL because referral disclosures are absent.

- [ ] **Step 3: Update legal pages and referral documentation**

Use plain British English. Document exact successful path and failures: cookies blocked/cleared, expiry, another browser/device, invalid link, account predating click, existing immutable edge, self/circular edge, and current inability to prove two OAuth accounts are different people. State that earned milestone rows do not grant access.

- [ ] **Step 4: Run legal and voice tests**

Run: `npm test -- __tests__/legalPages.test.ts __tests__/emDashLaw.test.ts __tests__/frictionVoice.test.ts`

Expected: PASS.

### Task 5: Full verification and mobile evidence

**Files:**
- Modify only if verification finds a defect.

**Interfaces:**
- Consumes: all Tasks 1-4.
- Produces: verified implementation and screenshots for PR body.

- [ ] **Step 1: Run targeted referral suite**

Run: `npm test -- __tests__/referrals.test.ts __tests__/referralStore.test.ts __tests__/referralRoutes.test.ts __tests__/pubmaxxAccountHub.test.ts __tests__/legalPages.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full project gate**

Run: `npm run verify`

Expected: PASS with zero lint, type, test, coverage, data-validation, or audit failures.

- [ ] **Step 3: Run app in isolated dist directory**

Run: `NEXT_DIST_DIR=.next-referral npm run dev -- --port 3107`

Expected: app serves on `http://localhost:3107`.

- [ ] **Step 4: Verify at 390px**

Open with `chrome-devtools-axi`, emulate `390x844x3,mobile,touch`, sign into the keyless test path if available, inspect account referral card reflow, keyboard focus, copy fallback, and absence of horizontal overflow. Save screenshots under `docs/screenshots/`.

- [ ] **Step 5: Review diff and restore local tooling churn**

Run: `git diff --check`, inspect `git diff`, and restore only generated `next-env.d.ts` or `package.json` changes caused by local commands.

- [ ] **Step 6: Commit**

```bash
git add app components lib supabase/migrations __tests__ docs
git commit -m "feat: add gated referral attribution machinery"
```
