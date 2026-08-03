# Clerk auth Firefox proof

Browser evidence that Clerk identity works end to end on the development
instance (`rare-trout-29.clerk.accounts.dev`).

## How the shots were made

```bash
# Keys only in gitignored .env.local (see .env.example for the contract).
npm run dev -- -p 3127
node scripts/clerk-auth-firefox-proof.mjs http://localhost:3127
```

Playwright **Firefox** only. `chrome-devtools-axi` does not write screenshot
files; Zen cannot be driven.

## Shots

| File | State |
|---|---|
| `01-signed-out.png` | Compact Sign in open; Create account + Sign in with a PUBMAXX account |
| `02-sign-up-waitlist.png` | Create account opens Clerk waitlist (instance config, not an app defect) |
| `03-signed-in.png` | After password sign-in; "Signed in to your PUBMAXX account" |
| `04-signed-out-again.png` | After `Clerk.signOut()` |
| `05-signed-in-again.png` | Second sign-in |

`report.json` carries the user id and email used for the run.
`missing-secret-guard.txt` records the half-configured boot assertion.

## Instance limits (honest)

- `user_settings.sign_up.mode` is **waitlist** on this development instance.
  Open self-serve sign-up is disabled until that is toggled off in the Clerk
  dashboard. The proof creates the account via the Backend API, then signs in
  through the real modal.
- Supabase has many tables with RLS enabled and no policies. A Clerk session is
  **not** a PUBMAXX User ID / Handle and cannot read those rows. Empty plans,
  saved pubs and messages after sign-in are expected until RLS policy work
  lands (separate captain lane). Do not paper over that with empty-state copy
  that implies there is no data.

## Two-key guard

`proxy.ts` only wraps `clerkMiddleware` when **both**
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set
(`isClerkMiddlewareConfigured` in `lib/clerkIdentity.ts`). A missing secret
leaves the plain security proxy in place so the site still boots.
