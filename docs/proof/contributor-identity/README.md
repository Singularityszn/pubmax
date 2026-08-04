# Contributor identity Firefox proof

Browser evidence that account-bound contributor identity surfaces render on
current main (feature already landed as #673; see `LANDING_REPORT.md`).

## How the shots were made

```bash
# Free the e2e port first if needed.
export NEXT_DIST_DIR=.next-prod-identity
export NEXT_PUBLIC_SUPABASE_URL=https://pubmaxx-e2e.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=pubmaxx-e2e-publishable-key
export PUBMAX_E2E_KEYLESS=1
node scripts/run-with-restored-next-env.mjs npm run build
npm run start -- --port 3128
# other terminal:
node scripts/contributor-identity-firefox-proof.mjs http://localhost:3128
```

Playwright **Firefox** only. `chrome-devtools-axi` reports paths and writes no
files.

## Shots

Each scenario × viewport × theme:

| Prefix | State |
|---|---|
| `signed-out-*` | Anonymous map with venue selected |
| `onboarding-*` | Signed-in session, incomplete onboarding dialog (handle + date of birth) |
| `signed-in-*` | Signed-in session with public handle |

Viewports: `phone` = 390×844, `desktop` = 1440×900.
Themes: `light`, `dark`.

`report.json` records base URL, venue id, and capture time.

## Auth boundary

Shots use the same E2E Supabase boundary as `e2e/price-submission.spec.ts`:
seeded localStorage session + route interception. Server stores stay keyless
and in memory. A Clerk session is not a PUBMAXX User ID (see
`docs/proof/clerk-auth/`).
