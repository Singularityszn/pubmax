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
| `signed-in.spec.ts` | Pub Pal answers a message typed into "Message your Pub Pal" on `/pal`. On the first run it walks the five-step Pub Pal setup a new account meets. | One Pub Pal turn, and a Pal on the first run |
| `signed-in.spec.ts` | A Plan is created and locked in. | One Plan, then abandoned |
| `signed-in.spec.ts` | A venue is saved to "Want to Visit", and the list's own page shows it. | One save |
| `signed-in.spec.ts` | The owner's profile shows the save. | None |
| `signed-in.spec.ts` | The save is removed again. | The save is removed |
| `signed-in.spec.ts` | The account signs out. | None |

The signed-in journeys share one session and run in order. Each write is undone
before the run ends, and `afterAll` undoes it again when a journey fails partway.

- **Plans have no delete.** The suite sets its Plan to `abandoned`, the end state a
  host can choose. The row stays in the database.
- **Saves toggle.** The suite taps the same list chip again to remove the save. It
  reads the list from `/api/saved-pubs` before it saves and after every tap, so a
  save left by a run that crashed is removed before the next run saves again.
- **Pub Pal turns** expire through the `purge-pub-pal-turns` cron.
- **The Pal stays.** The first run creates the smoke account's Pal through the
  setup a new user meets. Every later run finds it and goes straight to the
  message box.

### A defect the suite found

On 5 October 2026 the suite found that a full load of the owner's own
`/u/<handle>` showed "No saved venues yet." after a save had landed. #2004 fixed
it. The journey "The owner's profile shows the save" now holds the profile to
that fix.

## Run it

```sh
# Read-only: the signed-in journeys skip without credentials.
npm run test:prod-smoke

# Full run with the smoke account.
SMOKE_USER_HANDLE=... SMOKE_USER_PASSWORD=... npm run test:prod-smoke

# A local production build of a commit that is not deployed yet.
SMOKE_BASE_URL=http://localhost:3400 npm run test:prod-smoke
```

Plain `http` is accepted on loopback only. Every other origin must be `https`.

The HTML report goes to `playwright-report/prod-smoke/`. Each journey's
screenshot goes to `test-results/prod-smoke/<test>/`.

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

Before the suite runs, the workflow checks that the live site serves the
deployment that started it. Both the deployment's own URL and
`https://pubmaxxing.com` answer `/api/version` with a Vercel deployment id. If a
newer deploy already serves production, the run skips with a notice, because the
newer deploy's own run tests it. If production moves while the suite runs, the
run fails and says so: its verdict no longer belongs to the commit it checked
out. A dispatched run tests the ref it was dispatched on, so dispatch it on the
commit that is live.

The workflow always tests `https://pubmaxxing.com`, so the smoke account's
secrets never go to another origin. `SMOKE_BASE_URL` is for local runs only.

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
   The first run also meets a Pub Pal for the account, as a new user would.

Keep the account for the smoke suite only. Do not follow people, join crews or
post with it. The suite assumes the "Want to Visit" list holds nothing it did
not put there.

Sign-in uses the handle, not the email. The site has no email and password
form: email sends a magic link, and passwords pair with a handle
(`/api/auth/handle-password`).

## Prove the signed-in half locally

The signed-in journeys can run against a local Supabase with a seeded account,
before the smoke account exists. A production build cannot do this: its content
security policy admits only `*.supabase.co`, so the app must run as `next dev`.

1. Start Docker, for example `colima start`.
2. Copy `supabase/` to a scratch folder, change its `project_id`, and run
   `supabase start` there. It applies every migration.
3. Put the stack's URL, publishable key and service-role key in the environment
   as `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
4. Seed the account: `PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run e2e:seed`.
   It writes the handle and password to `.e2e/qa-credentials.json`.
5. Start `next dev --port 3401` with the same environment.
6. Run the suite with `SMOKE_BASE_URL=http://localhost:3401` and the seeded handle
   and password.
7. Remove the account afterwards with `npm run e2e:teardown`, then `supabase stop`.

Two Pub Pal checks cannot pass locally:

- **With ElevenLabs keys set**, as in production, Pub Pal runs its tools through
  webhooks to the deployed site. A local reply has no cards, so "venue cards"
  only passes live or without those keys.
- **The `/pal` hand-off** opens `/pal/chat?ask=`, but under `next dev` React's
  double effect run cancels the ask before it is sent. A production build sends
  it.

## Limits the suite stays under

Production rate limits count every request from the runner's IP address.

| Route | Limit | The suite sends |
| --- | --- | --- |
| `/api/auth/handle-password` | 12 per 15 minutes | 1 |
| `/api/pub-pal/chat` | 20 per minute | 2 |
| `POST /api/plans` | 8 per minute | 1 |
| `/api/saved-pubs` writes | 8 per minute per handle | 2 to 3 |
