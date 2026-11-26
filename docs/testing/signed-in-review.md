# Signed-in review harness

The seeded review below uses one PUBMAXX QA account in the Supabase project configured in `.env` or `.env.local`.
For Plan recovery or shortlist checks against a temporary local project, use [disposable Plan recovery](#disposable-plan-recovery).

## Build and seed

Set these values in `.env` or `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Keep the service-role key local. The seed command refuses to run without the explicit local flag.

```sh
export PUBMAX_E2E_LOGIN=1
export VERCEL_ENV=development
npm run e2e:seed
```

The seed is idempotent. It resets the password, removes prior QA data and writes the new password to `.e2e/qa-credentials.json` with owner-only permissions. It does not print the password. The profile is `@e2e_qa`, with display name `QA (automated)`, and never receives a founding-member number.

Playwright builds the authenticated server itself. To build it manually for a local production-style review, run:

```sh
PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run build
```

## Run authenticated Playwright review

Install Chromium once, then run the authenticated project:

```sh
npx playwright install chromium
PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run test:e2e -- --project=chromium-authenticated
```

The smoke spec signs in through the handle and password form, opens `/u/you`, and checks `@e2e_qa`. Reviewers can use the same form in Chrome DevTools when running the local app:

```sh
PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run dev
```

Open `http://localhost:3000/login`, choose the handle and password option, enter the values from `.e2e/qa-credentials.json`, then open `/u/you`. Stable selectors are `e2e-login-toggle`, `e2e-login-handle`, `e2e-login-password`, and `e2e-login-submit`.

## Tear down

Remove the QA user, profile, follows, referral edges, content, storage objects and local credentials after review:

```sh
PUBMAX_E2E_LOGIN=1 VERCEL_ENV=development npm run e2e:teardown
```

The seed and teardown refuse production Vercel environments. CI also refuses remote production targets. Never commit `.e2e/qa-credentials.json`.

## Disposable Plan recovery

`npm run test:e2e:plan-auth` runs Plan capability recovery and new-account logging cases against a temporary local Supabase project.
The cases live in `e2e/plan-capability-recovery.spec.ts` and `e2e/log-intent-composer.spec.ts`.
The runner requires Docker, the Supabase CLI, the project dependencies, and Playwright Chromium.
`DOCKER_HOST` must name an existing local Unix socket with an absolute `unix://` path.
Docker context and TLS overrides must be unset.

With the local Docker service running and `DOCKER_HOST` configured, run:

```sh
npm run test:e2e:plan-auth
```

The runner creates a unique project in `.plan-auth-*` inside the checkout and selects temporary ports.
It requires the migration files to match the committed inventory before it copies and applies them to that project.
It creates local accounts with generated credentials and verifies their sessions through local Supabase Auth.
It requires no existing account credentials or production data.
The browser process uses the temporary project's keys.
Its child environment blanks checkout environment-file variables before it sets local test values.
The runner builds and serves the app in its own `.next-pubmax-auth-*` directory for the Plan journeys.
The new-account journeys run on `next dev` in a separate directory.
A production build starts email sign-in on pubmaxxing.com, and its CSP blocks a local GoTrue.
They submit the real email form, read the link from the project's Mailpit catcher, and follow it.

The specs cover these journeys:

- A signed-in host restores a lost Plan cookie on page entry.
- A signed-in host restores a lost Plan cookie after a mounted status action, then saves the status with another tap.
- A signed-out browser sends no account recovery write after cookie loss.
- A new account logs a public Pint Drop through each login door, starting from the [home page](../../README.md#features).

The mounted journey checks that recovery causes no document navigation.
The signed-in journeys are skipped in the normal keyless suite.
Shared keyless authentication doubles do not verify these account recovery paths.

### Group night shortlist mode

Use the same disposable runner with `--shortlist` for the [group night flow](../../README.md#group-night-shortlist):

```sh
npm run test:e2e:plan-auth -- --shortlist
```

This mode requires Playwright WebKit and Chromium already installed.
It runs `e2e/plan-shortlist.spec.ts` and `e2e/plan-shortlist-disposable.spec.ts` instead of the default recovery and logging cases.
The `webkit-shortlist` project emulates an iPhone 13 at 390 × 844. The `chromium-shortlist` project emulates a Pixel 7.
Each browser uses its own disposable Supabase project and application server, so their rate limits stay independent.
Playwright writes shortlist results to a separate subdirectory of `test-results/` for each browser.
These are local browser emulations. They do not establish remote staging or physical-device results.

Coverage includes organiser creation, signed-out voting and changes, confirmation at the same URL, directions, revoked and expired links, and late-vote refusal.
The disposable cases also cover layout and theme variants, large text, aging prices, stale refreshes, no-vote confirmation and organiser capability recovery.
Set `PW_SHORTLIST_EVIDENCE` to an existing evidence directory to save screenshots and browser-error logs.
The [shortlist measurement rules](../analytics/METRICS.md#32-invitation-response-measures) govern pilot attendance evidence.

### Cleanup

After its child processes stop, the runner calls `supabase stop --no-backup`.
It then checks for leftover Docker containers, volumes, and networks, even when `supabase stop` succeeds.
It removes only resources with the `supabase_` prefix and the exact `_<projectId>` suffix.
If resources remain or Docker cleanup cannot be confirmed, the runner reports the project, exits unsuccessfully, and preserves its configuration directory for recovery.
It removes build output after its child processes stop and configuration only after backend cleanup succeeds.
Playwright results remain in `test-results/`.

## PostgreSQL test contention

The full Vitest suite starts several temporary PostgreSQL 16 sessions. A concurrent crew can exhaust macOS shared-memory identifiers, and `initdb` then reports `could not create shared memory segment: No space left on device` with `shmget`. This is shared-memory contention, not disk usage. Wait for other PostgreSQL-backed test runs to finish, then rerun `npm test` serially.
