# Contributor identity landing report

Branch: `fm/land-contributor-identity`
Base: `origin/main` @ `fd637a6b` (Clerk auth #702)
Source branch investigated: `origin/fm/contributor-identity` @ `43038a17`

## Verdict

**The feature is already on main.** There is no residual product delta to
rebase. A wholesale rebase of `fm/contributor-identity` onto current main would
**regress** Clerk (#702) and account-bound report binding (#682).

| Claim in the launch brief | Finding |
|---|---|
| Branch adds 34 files main does not have | **Stale.** Core identity files already exist on main (landed via #673). File-only-on-feature count is dominated by unrelated `public/data/uk_base` packs, not identity code. |
| Branch is far behind main | True: merge-base `4d25088d`; main +30 / feature +27 at investigation time. |
| Need to land contributor identity | Already shipped as **#673** (`feat(identity): require account-bound contributor identities`), head `fm/contributor-identity`, squash-merged 2026-07-29. Follow-ons: **#682** (reports / weather recommendations), **#702** (Clerk beside Supabase). |

## What the feature is (and where it lives on main)

Stable profile actor that community prices, visit reports and rounds bind to:

- Signed-in, handle-attributed community price submissions bound to the account
  profile actor; legacy rows without a handle stay anonymous
  (`lib/communityPriceStore.ts`, `lib/contributionIdentity.server.ts`,
  `app/api/price-submit/route.ts`).
- Membership resolves through stable profile ownership so a handle rename does
  not strand a member or a retry (`lib/profileOwnership.ts`,
  `lib/identityHandleStore.ts`, rounds ownership in `lib/roundsStore.ts` +
  migrations `0062`–`0064`).
- Contributor totals are derived on the server from observation rows, never
  stored or client-supplied (leaderboard + store read paths; see AGENTS.md).

Key surfaces already on main:

- `components/identity/AccountOnboarding.tsx` — handle + date of birth at signup
- `components/identity/ContributionGateDialog.tsx` — contribution gate
- `components/identity/PrivateIdentityEditor.tsx` — private profile editor
- `app/api/identity/onboarding/route.ts`
- Migrations `20260729120000_0061_contributor_identity.sql` through
  `20260729140000_0064_round_price_key_owners.sql`

Content hashes of the load-bearing modules match between
`origin/fm/contributor-identity` tip and `origin/main`:

- `lib/privateIdentityStore.ts`
- `lib/roundsStore.ts`
- `lib/roundRequest.ts`
- `lib/identityHandleStore.ts`
- `supabase/migrations/20260729120000_0061_contributor_identity.sql`
- `supabase/migrations/20260729140000_0064_round_price_key_owners.sql`

## Rebase attempt

Started: `git reset --hard origin/fm/contributor-identity && git rebase origin/main`

Stopped on commit 1/27 (`a7345760 feat: bind contributions to account identity`)
with ~40 conflicts (many **add/add** — main already has the same paths from the
#673 squash).

### How conflicts would have been resolved (honest)

Because #673 already introduced these files on main, and #682/#702 extended
them, the correct per-conflict policy is:

| Conflict class | Resolution | Why |
|---|---|---|
| Add/add identity modules already identical on both tips | Keep **main** (ours during rebase) | No product delta; avoids thrash |
| `lib/contributionIdentity.server.ts` | Keep **main** (`verifyCallerAuth` + 503 `AUTH_VERIFICATION_UNAVAILABLE`) | Feature tip still uses older `callerUserId` and drops the unavailable path #682 added |
| `components/auth/AuthProvider.tsx` | Keep **main** | Feature tip removes `contributionAuth` / `invalidateContributionAuth` / `accountBoundFetch` integration and the no-config loading derivation; main also hosts Clerk-adjacent account controls |
| `components/auth/SignInButton.tsx` | Keep **main** | Clerk sits beside Supabase (#702); feature tip is single-auth-era |
| `components/identity/ContributionGateDialog.tsx` | Keep **main** | Main has the #682 account-auth binding; feature tip is a thinner pre-#682 gate |
| Legal / privacy / terms / METRICS / WRITE_SURFACE docs | Keep **main**, then re-check only if feature tip still names a rule main dropped | Main already reflects post-age-gate private signup policy |
| `app/api/price-submit/route.ts` | Keep **main** | Server verification and Clerk-safe identity resolution |
| Tests that only exist as stronger main coverage (`contributionAuthProvider`, `contributionIdentityVerification`, `accountScopedComposer`) | Keep **main** | Feature tip would delete them |

No conflict required a product guess that would append `needs-decision:`. The
branch assumption that was wrong is **“this work is still unmerged”**, not a
behaviour fork inside the identity model.

Rebase was **aborted**. Working branch reset to `origin/main` so we do not ship a
regression disguised as a land.

## Clerk reconciliation (#702)

A Clerk session is **not** a PUBMAXX User ID / Handle.

On main today:

- `lib/clerkIdentity.ts` + two-key gate in `proxy.ts`
  (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`)
- `components/auth/SignInButton.tsx` and `ClerkAccountControls.tsx` sit **beside**
  Supabase auth, not instead of it
- Contribution identity resolution goes through `verifyCallerAuth` /
  Supabase-shaped caller identity (`lib/authServer.ts`,
  `lib/contributionIdentity.server.ts`)
- Firefox proof for Clerk: `docs/proof/clerk-auth/`

The feature branch predates Clerk and would have overwritten AuthProvider /
SignInButton toward a Supabase-only shape. **Reconciliation = keep main’s dual
auth surface; do not re-apply the branch’s auth files.**

## RLS (PR 707 sibling)

No RLS policies written in this lane (per non-goals).

Identity-related tables that already have RLS enabled with no policies (sibling
lane ownership) include at least the contributor-identity migration objects
(`private_identities` / handle tables / round ownership tables from migrations
0061–0064). **Name for the RLS lane:** grant/deny policies for:

1. `private_identities` — owner read/write only; never public
2. Identity handle claim / rename paths — owner + service role
3. Round membership / price-key owner tables — members of the round + service role
4. Community price / visit report rows that store `account_id` / handle
   attribution — public read of non-hidden rows; insert only as the verified
   caller’s account

Exact table names: see `supabase/migrations/20260729120000_0061_contributor_identity.sql`
and sibling 0062–0064. Do not invent policies here.

## Proof gates (this worktree @ main)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors (29 pre-existing warnings, unrelated) |
| Full unit suite | **7488** passed (floor was 7482; did not go down) |
| Identity-focused suite | 124 passed across onboarding, private identity, price-submit, rounds, contribution auth |

### Tests that would fail if this behaviour were missing

The brief asked for tests that fail against `origin/main` for behaviour this
branch adds. **There is no residual behaviour.** The distinguishing tests
already live on main and are green. Removing the feature would fail, among
others:

- `__tests__/identityOnboardingRoute.test.ts`
- `__tests__/privateIdentityStore.test.ts`
- `__tests__/contributionIdentityVerification.test.ts`
- `__tests__/contributionAuthProvider.test.ts`
- `__tests__/accountBoundFetch.test.ts`
- `__tests__/priceSubmitRoute.test.ts` (signed-in / onboarding gates)
- `__tests__/roundsRoute.test.ts` (ownership, promotion, rename-safe membership)
- `e2e/price-submission.spec.ts` (onboarding dialog + attributed submit)

Inventing new tests that fail on main would mean asserting behaviour main does
not have — which is the opposite of an honest land.

## Screenshots

Playwright **Firefox**, committed under this directory:

| Scenario | Viewports | Themes |
|---|---|---|
| `signed-out` | phone 390×844, desktop 1440×900 | light, dark |
| `onboarding` (signed-in, incomplete private signup) | same | same |
| `signed-in` (handle present) | same | same |

Produced by `scripts/contributor-identity-firefox-proof.mjs` against a keyless
production build with the E2E Supabase boundary env.

## Non-goals respected

- Did not merge, push to `main`, or deploy
- Did not change page copy or information architecture
- Did not write RLS policies
- No new product features beyond documenting the already-landed work

## Recommended next action for firstmate

1. Treat `fm/contributor-identity` as **historical / already merged** (#673).
2. Optionally delete or archive the remote branch to stop Wave 3 re-dispatch.
3. Keep Clerk (#702) and RLS (#707) on their own lanes; do not re-open identity
   foundation work unless a concrete residual bug is named.
