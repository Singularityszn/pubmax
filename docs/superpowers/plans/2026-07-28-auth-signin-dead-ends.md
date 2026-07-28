# Auth Sign-in Dead Ends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only Supabase social providers that are currently enabled, keep email sign-in complete when none are available, and redirect Vercel production aliases to the canonical site.

**Architecture:** A browser auth capability module reads Supabase's public `/auth/v1/settings` response with the publishable key and maps Supabase's `azure` provider to the product's Microsoft label. `AuthProvider` owns live capability state and rechecks the selected provider immediately before starting OAuth, while one shared social-button component renders that state across all sign-in surfaces. Next.js emits a wildcard `*.vercel.app` host redirect only in Vercel production builds, leaving local and preview builds untouched.

**Tech Stack:** Next.js 16 redirects, React 19 context and client components, Supabase Auth settings, TypeScript, Vitest, React server rendering

## Global Constraints

- Disabled or unknown social providers never render as clickable sign-in choices.
- Provider state comes from `GET /auth/v1/settings`; no provider is hardcoded as enabled.
- Email sign-in remains available when social-provider state is empty or unavailable.
- OAuth start rechecks provider state so stale UI cannot navigate to Supabase's raw unsupported-provider page.
- Production `*.vercel.app` hosts redirect permanently to `https://pubmaxxing.com` with path and query preserved.
- Local development and Vercel preview builds do not receive the production-alias redirect.
- Do not enable Supabase providers or change provider credentials.

---

### Task 1: Supabase provider capability contract

**Files:**
- Create: `lib/authProviderAvailability.ts`
- Create: `__tests__/authProviderAvailability.test.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, global browser `fetch`
- Produces: `SocialAuthProviderAvailability`, `NO_SOCIAL_AUTH_PROVIDERS`, `loadSocialAuthProviders`, `guardSocialAuthProvider`

- [ ] **Step 1: Write failing settings and guard tests**

Cover literal Supabase payloads:

```ts
{ external: { google: true, azure: false, email: true } }
{ external: { google: false, azure: true, email: true } }
```

Assert the request targets `/auth/v1/settings`, sends the `apikey` header, maps `azure` to `microsoft`, returns `null` for HTTP/network/malformed failures, and does not call the OAuth starter when a provider is disabled or settings cannot be read.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run __tests__/authProviderAvailability.test.ts
```

Expected: FAIL because `lib/authProviderAvailability.ts` does not exist.

- [ ] **Step 3: Implement the fail-closed capability reader**

Add:

```ts
export type SocialAuthProvider = "google" | "microsoft";
export type SocialAuthProviderAvailability = Record<SocialAuthProvider, boolean>;

export const NO_SOCIAL_AUTH_PROVIDERS: SocialAuthProviderAvailability = {
  google: false,
  microsoft: false,
};

export async function loadSocialAuthProviders(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<SocialAuthProviderAvailability | null>;

export async function guardSocialAuthProvider(
  provider: SocialAuthProvider,
  start: () => Promise<{ error: string | null }>,
  load?: () => Promise<SocialAuthProviderAvailability | null>,
): Promise<{
  availability: SocialAuthProviderAvailability | null;
  result: { error: string | null };
}>;
```

`loadSocialAuthProviders` must require both public settings, use the existing bounded auth fetch helper, require an object-shaped `external` response, and interpret only literal `true` as enabled. `guardSocialAuthProvider` must return provider-specific email fallback copy without invoking `start` unless the fresh settings read enables the provider.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run __tests__/authProviderAvailability.test.ts
```

Expected: PASS.

### Task 2: Provider-aware sign-in surfaces

**Files:**
- Create: `components/auth/SocialSignInButtons.tsx`
- Modify: `components/auth/AuthProvider.tsx`
- Modify: `components/auth/SignInButton.tsx`
- Modify: `components/auth/MagicLinkForm.tsx`
- Modify: `components/identity/IdentityNudge.tsx`
- Create: `__tests__/socialSignInButtons.test.ts`

**Interfaces:**
- Consumes: `SocialAuthProviderAvailability`, `loadSocialAuthProviders`, `guardSocialAuthProvider`
- Produces: `AuthContextValue.socialProviders`, shared `SocialSignInButtons`, `MagicLinkForm.hasSocialProviders`

- [ ] **Step 1: Write failing render tests**

Render the shared component to static markup and assert:

```ts
{ google: false, microsoft: false } // no Google or Microsoft button
{ google: true, microsoft: false }  // Google only
{ google: false, microsoft: true }  // Microsoft only
```

Render `MagicLinkForm` with `hasSocialProviders={false}` and expect `Continue with email`; render with `true` and expect `Or continue with email`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run __tests__/socialSignInButtons.test.ts
```

Expected: FAIL because the shared component and email-label prop do not exist.

- [ ] **Step 3: Implement shared provider rendering**

Move Google and Microsoft marks and buttons into `SocialSignInButtons`. Return `null` when both providers are unavailable. Render each button only when its corresponding capability is true.

- [ ] **Step 4: Load capability state in `AuthProvider`**

Start from `NO_SOCIAL_AUTH_PROVIDERS`. After mount, load settings asynchronously and set either the returned value or the all-false value. Expose capability state through context.

Wrap each existing provider-specific OAuth start in `guardSocialAuthProvider`. Update context state from every fresh result before returning the guard result. This makes a provider disabled since page load disappear on click and prevents `signInWithOAuth` from running.

- [ ] **Step 5: Port both consumers**

Replace duplicated buttons in `SignInButton` and `IdentityNudge` with `SocialSignInButtons`. Pass `hasSocialProviders` to `MagicLinkForm`, so email reads as the primary path when no social provider is enabled.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run __tests__/authProviderAvailability.test.ts __tests__/socialSignInButtons.test.ts
```

Expected: PASS.

### Task 3: Production Vercel alias canonicalisation

**Files:**
- Modify: `next.config.mjs`
- Create: `__tests__/vercelProductionHostRedirect.test.ts`

**Interfaces:**
- Consumes: Vercel system variable `VERCEL_ENV`
- Produces: production-only Next.js host redirect for `*.vercel.app`

- [ ] **Step 1: Write failing redirect tests**

Stub `VERCEL_ENV=production`, load redirects, and require a rule shaped as:

```ts
{
  source: "/:path*",
  has: [{ type: "host", value: "<regex matching any vercel.app subdomain>" }],
  destination: "https://pubmaxxing.com/:path*",
  permanent: true,
}
```

Assert the regex matches `chengdu-pubmax69.vercel.app`. Stub `VERCEL_ENV=preview` and unset it for local mode, then assert neither configuration includes the wildcard Vercel host rule.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run __tests__/vercelProductionHostRedirect.test.ts
```

Expected: FAIL because no Vercel alias redirect exists.

- [ ] **Step 3: Add the conditional redirect**

Build the redirects array with a `*.vercel.app` host rule only when `process.env.VERCEL_ENV === "production"`. Keep the existing `www` and path redirects unchanged. Next.js wildcard path substitution preserves the path, and an incoming query is copied when the destination supplies no replacement query.

- [ ] **Step 4: Run focused redirect tests**

Run:

```bash
npx vitest run __tests__/vercelProductionHostRedirect.test.ts __tests__/wwwHostRedirect.test.ts
```

Expected: PASS.

### Task 4: End-to-end verification and closeout

**Files:**
- Verify only

**Interfaces:**
- Consumes: complete implementation
- Produces: fresh evidence for acceptance criteria

- [ ] **Step 1: Run focused unit tests**

```bash
npx vitest run __tests__/authProviderAvailability.test.ts __tests__/socialSignInButtons.test.ts __tests__/vercelProductionHostRedirect.test.ts __tests__/wwwHostRedirect.test.ts
```

- [ ] **Step 2: Run project gate**

```bash
npm run verify
```

- [ ] **Step 3: Run isolated production build**

```bash
VERCEL_ENV=production NEXT_DIST_DIR=.next-prod npm run build
```

- [ ] **Step 4: Exercise host redirects against built app**

Start the isolated build. Request a nested path with a query using `Host: chengdu-pubmax69.vercel.app` and assert a 308 to the same path and query on `https://pubmaxxing.com`. Request the same URL with a preview host from a preview-mode build or verify the preview redirect set lacks the rule.

- [ ] **Step 5: Inspect `/u/you`**

Run the app with controlled public Supabase settings. Confirm the all-disabled response shows no social buttons and a complete email form. Confirm a Google-enabled response shows Google without a code change. Confirm a failed settings response shows no social buttons.

- [ ] **Step 6: Review, commit, and report**

Inspect the complete diff, restore local tooling churn, run required project memory check, commit on `fm/auth-signin-dead-ends`, and append the required terminal status.
