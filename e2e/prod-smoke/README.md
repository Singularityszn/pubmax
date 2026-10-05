# Production smoke suite

Real journeys against a deployed PubMaxxing site. Nothing is mocked and no local
server starts. The suite has its own config, `playwright.prod-smoke.config.ts`,
and the main browser suite ignores this folder.

## What it covers

| Spec | Journey | Writes |
| --- | --- | --- |
| `public.spec.ts` | The landing page loads. | None |
| `public.spec.ts` | The London and Manchester maps paint pins. | None |
| `public.spec.ts` | A pub search opens the venue sheet. | None |
| `public.spec.ts` | The venue sheet shows Google Places hours and address. | None |
| `public.spec.ts` | The coffee lens shows a Shoreditch cafe's listed prices. | None |
| `signed-in.spec.ts` | The smoke account signs in with handle and password. | A session |
| `signed-in.spec.ts` | Pub Pal answers a text request with a plan and venue cards. | One Pub Pal turn |
| `signed-in.spec.ts` | A Plan is created and locked in. | One Plan, then abandoned |
| `signed-in.spec.ts` | A venue saved to "Want to Visit" shows on the owner's profile. | One save, then removed |
| `signed-in.spec.ts` | The account signs out. | None |

The signed-in journeys share one session and run in order. Each write is undone
before the run ends, and `afterAll` undoes it again when a journey fails partway.

- **Plans have no delete.** The suite sets its Plan to `abandoned`, the end state a
  host can choose. The row stays in the database.
- **Saves toggle.** The suite taps the same list chip again to remove the save. A
  save left by a run that crashed is removed before the next run saves again.
- **Pub Pal turns** expire through the `purge-pub-pal-turns` cron.

## Run it

```sh
# Read-only: the signed-in journeys skip without credentials.
npm run test:prod-smoke

# Full run with the smoke account.
SMOKE_USER_HANDLE=... SMOKE_USER_PASSWORD=... npm run test:prod-smoke

# Another deploy, such as a preview with production values.
SMOKE_BASE_URL=https://example.vercel.app npm run test:prod-smoke

# A local production build of a commit that is not deployed yet.
SMOKE_BASE_URL=http://localhost:3400 npm run test:prod-smoke
```

Plain `http` is accepted on loopback only. Every other origin must be `https`.

The HTML report goes to `playwright-report/prod-smoke/`. Each journey's
screenshot goes to `test-results/prod-smoke/<test>/`. Set `SMOKE_OUTPUT_NAME`
to use another folder name, so a second run keeps the first run's results.

The suite uses one worker and no retries. A flaky journey fails the run so that
someone sees it. Timeouts allow for real network latency instead.

## After every deploy

`.github/workflows/prod-smoke.yml` runs the suite when Vercel reports a
successful Production deployment to GitHub. It checks out the deployed commit,
so the specs match the code they test. Vercel's Git integration sends that
report. A `vercel deploy --prod` from a laptop does not, so start the workflow
by hand after one:

```sh
gh workflow run prod-smoke.yml
```

The workflow sets `SMOKE_REQUIRE_SIGN_IN=1`. If a secret is missing, the run
fails instead of quietly testing only the read-only half.

## Make the smoke account

The captain makes the account and the secrets. An agent never does.

1. Choose a mailbox the team controls and does not use for anything else, such
   as a plus address.
2. Open `https://pubmaxxing.com/login`, choose **New here**, and sign up with
   that email. Pick a handle that says what it is, such as `pubmaxx_smoke`.
3. On the profile, create a password. It needs at least 8 characters, with one
   capital letter, one number and one special character.
4. Sign out. Then sign in once with **Sign in with handle and password** to
   prove the pair works.
5. Add two repository secrets in GitHub under Settings, Secrets and variables,
   Actions:
   - `SMOKE_USER_HANDLE`: the handle without the `@`.
   - `SMOKE_USER_PASSWORD`: the password.
6. Run `gh workflow run prod-smoke.yml` and check that every journey passes.

Keep the account for the smoke suite only. Do not follow people, join crews or
post with it. The suite assumes the "Want to Visit" list holds nothing it did
not put there.

Sign-in uses the handle, not the email. The site has no email and password
form: email sends a magic link, and passwords pair with a handle
(`/api/auth/handle-password`).

## Limits the suite stays under

Production rate limits count every request from the runner's IP address.

| Route | Limit | The suite sends |
| --- | --- | --- |
| `/api/auth/handle-password` | 12 per 15 minutes | 1 |
| `/api/pub-pal/chat` | 20 per minute | 1 |
| `POST /api/plans` | 8 per minute | 1 |
| `/api/saved-pubs` writes | 8 per minute per handle | 2 to 4 |
