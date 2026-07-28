# Canonical Auth Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every deployed authentication attempt returns through `https://pubmaxxing.com/auth/callback`, while local development continues to use its local origin.

**Architecture:** Add one shared site-origin resolver around the existing `NEXT_PUBLIC_SITE_URL` setting and canonical production fallback. In production, fail closed unless the resolved origin is exactly `https://pubmaxxing.com`. Auth callback construction and social OAuth routes consume that resolver, so deployed request hosts never become identity-provider redirect targets while non-production development stays same-origin.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase Auth, Vitest, Playwright-compatible browser QA.

## Global Constraints

- No new dependency or auth provider.
- Do not change handle or account models.
- Preserve safe same-origin post-auth paths and PKCE attempt coordination.
- Do not change Supabase or Vercel dashboard settings from code.
- Use `NEXT_PUBLIC_SITE_URL=https://pubmaxxing.com` as the single configured production site URL.
- Never use em dashes in source or documentation.

---

### Task 1: Lock the canonical callback contract

**Files:**
- Modify: `__tests__/passwordlessAuth.test.ts`

**Interfaces:**
- Consumes: `buildAuthCallbackUrl(currentUrl, requestedNext, attemptId)`
- Produces: Regression coverage proving deployed non-canonical origins cannot enter the provider callback and localhost remains local outside production.

- [x] **Step 1: Write the failing production-host regression test**

Add a test that stubs `NODE_ENV=production` and `NEXT_PUBLIC_SITE_URL=https://pubmaxxing.com`, calls `buildAuthCallbackUrl` from `https://chengdu-pubmax69.vercel.app/map?area=soho`, and expects the literal callback `https://pubmaxxing.com/auth/callback?next=%2Fmap%3Farea%3Dsoho&_authAttempt=<id>`.

- [x] **Step 2: Run the focused test and verify red**

Run: `npx vitest run __tests__/passwordlessAuth.test.ts -t "uses the canonical site for deployed auth callbacks"`

Expected: FAIL because callback origin is still `https://chengdu-pubmax69.vercel.app`.

- [x] **Step 3: Add local-development coverage**

Add a test that stubs `NODE_ENV=development`, calls the same function from `http://localhost:3000/map`, and expects `http://localhost:3000/auth/callback`.

### Task 2: Introduce and consume one site-origin resolver

**Files:**
- Create: `lib/siteUrl.ts`
- Modify: `lib/authRedirect.ts`
- Modify: `app/api/social-connections/[provider]/route.ts`
- Modify: `app/api/social-connections/[provider]/callback/route.ts`

**Interfaces:**
- Produces: `siteOrigin(currentUrl: string, environment?: string, configuredSiteUrl?: string): string | null`
- Consumes: `NEXT_PUBLIC_SITE_URL`, with `https://pubmaxxing.com` as production fallback.

- [x] **Step 1: Implement minimal resolver**

Parse and validate the current HTTP(S) URL. Return its origin outside production. In production, parse `configuredSiteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://pubmaxxing.com"` and return the origin only when it is exactly `https://pubmaxxing.com`. Return `null` for malformed, insecure, or non-canonical production inputs.

- [x] **Step 2: Route auth callback construction through resolver**

Keep the requested post-auth path derived from the initiating page, but build `/auth/callback` against `siteOrigin(currentUrl)`.

- [x] **Step 3: Route both social OAuth endpoints through resolver**

Replace duplicated `NODE_ENV` and `NEXT_PUBLIC_SITE_URL` branches with `siteOrigin(request.url)`. Preserve existing error handling if resolution fails.

- [x] **Step 4: Run focused tests and verify green**

Run: `npx vitest run __tests__/passwordlessAuth.test.ts __tests__/socialConnectionsRoutes.test.ts`

Expected: PASS.

### Task 3: Make deployment configuration exact

**Files:**
- Modify: `.env.example`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `components/auth/SignInButton.tsx`

**Interfaces:**
- Produces: Operator instructions matching code and Supabase callback contract.

- [x] **Step 1: Document the shared production site variable**

Add `NEXT_PUBLIC_SITE_URL=https://pubmaxxing.com` beside browser-auth settings, explaining that deployed builds use it for auth and social callback origins.

- [x] **Step 2: Correct Supabase dashboard instructions**

Specify Site URL `https://pubmaxxing.com`. Specify redirect URLs `https://pubmaxxing.com/auth/callback` and `http://localhost:3000/auth/callback`. Remove `www` and preview callbacks because deployed auth always returns through the apex.

- [x] **Step 3: Explain deployment-host controls**

Document Vercel deployment protection as access control, including its reviewer cost. Document an exact redirect for `chengdu-pubmax69.vercel.app` as canonicalisation, including the cost that the named alias stops showing its deployed build while other preview URLs remain reviewable. Explain that a wildcard deployment redirect would make every preview leave for production.

- [x] **Step 4: Update stale owner comment**

Point the sign-in component at exact canonical callback configuration rather than a generic `<site>` callback.

### Task 4: Browser and repository verification

**Files:**
- Create: `artifacts/auth-canonical-domain/local-sign-in.png`
- Create: `artifacts/auth-canonical-domain/local-link-sent.png`
- Create: `artifacts/auth-canonical-domain/local-callback.png`

**Interfaces:**
- Consumes: Running local application and shipped redirect builder.
- Produces: Browser screenshots and green repository checks.

- [x] **Step 1: Start local app and verify local sign-in**

Run `npm run dev`, open `http://localhost:3000`, use a 390x844 mobile viewport, open sign-in, and capture the local sign-in surface.

- [x] **Step 2: Verify callback navigation in browser**

Open a local `/auth/callback` URL with a safe `next` path and capture the resulting app page, proving the callback route remains local and functional.

- [x] **Step 3: Record dashboard-blocked production verification**

Record that a real magic-link email currently falls back to the configured Vercel Site URL, proving the dashboard defect. Do not claim successful production-session verification until the owner applies the exact Supabase Site URL and redirect allowlist values, then runs a production magic link and captures the canonical address plus signed-in header.

- [x] **Step 4: Run focused and full verification**

Run `npm run verify`. Fix every failure or flaky test encountered.

- [x] **Step 5: Review and prepare commit**

Review repository shape, diff, and documentation. Commit with a message that names the diagnosed Supabase fallback cause and canonical callback fix.
