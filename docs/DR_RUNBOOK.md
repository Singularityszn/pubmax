# Disaster recovery runbook

What to do when production data, an account, a key or a domain is lost. Written
after the durability audit of 6 October 2026, which found no database backup, a
single owner on each account and no rotation record.

Everything here is free. Production runs on the Supabase free plan, which keeps
no backups and has no point-in-time recovery, so the copy this runbook restores
from is the one `npm run backup:offplatform` writes. The repository is public.
Never commit a dump, never attach one to an Actions run, never paste a key into
an issue or a pull request.

Facts to start from:

| Thing | Value |
| --- | --- |
| Production database | Supabase project `iankajxliutqogqkmvdg`, region eu-west-2, free plan |
| Storage bucket | `pint-drops`, private |
| Hosting | Vercel project `chengdu`, team `pubmax69`, Git deploys are ignored, releases go through `npm run release:prod` |
| Domains | `pubmaxxing.com` (production), `pubmaxxing.co.uk` (redirect), registrar GoDaddy |
| Scratch project for drills | `pubmax-pentest`, paused. Resume it, use it, pause it again |
| Escalation list | [`OPS_FREEZE_RUNBOOK.md`](OPS_FREEZE_RUNBOOK.md) "Escalation list". Fill it in |

## Targets

- **Recovery point objective (RPO), the most data a loss can take: 1 day, once the agent is reinstalled.** The off-platform dump runs every night (launch plan, 1 November 2026), so a loss can take everything written since the last complete dump. A Mac still running the old weekly agent keeps a 7-day RPO until `npm run backup:install-launchd` runs again. If the Mac is asleep, off or away, no dump runs, and this figure has no limit until the next complete run.
- **Recovery time objective (RTO), the longest the restore may take: not measured yet.** The first restore drill sets it. Write the measured minutes in the drill log below, then write the target here. Until then there is no figure.

Accepted risks. Each one is known and open today:

- One region. Vercel functions run only in `lhr1` (`vercel.json`), and the database is in eu-west-2. Both are in London.
- One Supabase project holds all production data.
- One owner on each account. See section 4.
- One person on call.
- No point-in-time recovery (PITR), because the free plan does not have it. The nightly dump is the only way back.

The floor is automated. `__tests__/offPlatformBackupEffective.test.ts` builds the real schema from every migration, takes a dump with the backup script, and restores it into a fresh PostgreSQL cluster with the command in section 2. It fails when a table, a row count, a policy or a trigger does not come back, or when the restore prints an error not on its list. It does not prove a restore into Supabase, the bucket upload or the time a restore takes. The manual drill in section 1 is the real proof.

## 1. Make the backup, and prove it restores

### Take it

The backup runs on the captain's Mac. It needs `pg_dump` and `pg_restore` at the
server's major version or newer, and these variables in
`~/.config/pubmax/backup.env`, mode 0600 (never in the repository):

- `PUBMAX_BACKUP_DB_URL`: a `postgres://` connection string for the project (Supabase dashboard, Connect, session pooler).
- `PUBMAX_BACKUP_DB_AUTH`: optional, defaults to `password`. Set `cli-read-only` only for the approved temporary-login mode below.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: for the bucket sync.
- `PUBMAX_BACKUP_DIR`: optional, default `~/pubmax-backups`. The script refuses a directory inside any git checkout.
- `PUBMAX_ALERT_WEBHOOK_URL`: optional. A failed run posts one fixed line with no reason in it. The reason stays in the local log.

The optional `cli-read-only` mode needs the existing private `SUPABASE_ACCESS_TOKEN`.
A fine-grained token needs the Management API's `database_write` permission,
even though the database session is read-only.
The database URL must omit the password and use this project's direct endpoint
or session pooler on port 5432. The direct username is `postgres`. The pooler
username is `postgres.<project ref>`. The database is `postgres`, with no URL
options. `SUPABASE_URL` must be the canonical `https://<project ref>.supabase.co`.
The script refuses another project's endpoint or the transaction-pooler port.

Each normal run sends one `POST /v1/projects/<project ref>/cli/login-role` with
`{"read_only":true}` to the [Supabase Management API](https://supabase.com/docs/reference/api/v1-create-login-role).
This creates or refreshes a managed temporary login. The endpoint is Beta and
can change or disappear.
The script rejects invalid or expired credentials and keeps the returned
password in the `pg_dump` environment. It does not save that password or pass
the management token to PostgreSQL clients.

The dump uses `--role=supabase_read_only_user` and a read-only session.
Missing role membership, authentication, or table access fails the dump.
This mode retains all five schemas and their table data. Storage still needs
the existing service role key. A dry run makes no login request.
The script never resets the database password or deletes the managed login role.

```sh
node --env-file="$HOME/.config/pubmax/backup.env" scripts/backup-offplatform.mjs --dry-run   # prints the plan and touches nothing
node --env-file="$HOME/.config/pubmax/backup.env" scripts/backup-offplatform.mjs
```

It writes `pubmax-<UTC stamp>.dump` (custom format, mode 0600) with the `public`,
`auth`, `storage`, `supabase_migrations` and `pubmax_private` schemas, and syncs the bucket into
`bucket/pint-drops/`. A dump becomes visible only after `pg_restore --list` finds
table data and the bucket sync completes. Changed photos download into
`bucket/pint-drops.staging/` and replace the kept copies only after every object
has downloaded, so a failed sync removes the partial dump and the staged photos
and leaves the last complete dump and its photos exactly as they were.

### Schedule it

The captain or firstmate runs the installer once, from the checkout the job
should use. Agents do not run the installer.

The installer command is:

```sh
npm run backup:install-launchd
```

It writes the launchd agent `~/Library/LaunchAgents/com.pubmax.backup.plist` and
loads it. The agent runs the backup every night at 03:30 with the variables
from `backup.env`, and logs to `~/Library/Logs/pubmax-backup.log`. The installer
refuses while `backup.env` is missing or open to other users. Running it again
rewrites the same agent and reloads it, so run it again after the checkout moves.

Installation loads the calendar job without an immediate backup. The job does
not wake a sleeping or powered-off Mac. A missed calendar event can run after
wake, but an offline or unavailable Mac can delay backup and pruning beyond
eight weeks. Installation alone proves neither a successful backup nor durability.

### Retention

The copy holds personal data: account emails, password hashes, profiles, Pint
Drops and their photos. It is not encrypted. Normal pruning starts at 7 weeks.
The 8-week maximum applies once a newer complete backup exists. The last good
backup, the newest complete dump and its photos, is NEVER deleted: if newer
backups keep failing it is kept past 8 weeks, and every failed run says so in
the log and in the alert (owner decision, 16 October 2026).

- Each run deletes dumps older than 7 weeks, except the newest complete dump. That one goes only when a newer complete dump exists and it has passed 7 weeks. The one-week margin covers a Mac that misses some nights.
- A dump's name supplies its UTC age. The eight-week comparison includes the exact deadline. A newer filesystem timestamp cannot extend that age.
- When the newest complete dump has reached 8 weeks, a failed run logs `past the 8-week maximum` and its alert names the dump's UTC stamp. Fix the failing backup: the held copy goes on the first run after a newer backup completes.
- A `.partial` dump expires at 8 weeks or when a newer complete dump makes it redundant. A failed renewal, dump or bucket sync removes the current partial dump and the staged photos.
- Each photo's last-seen timestamp supplies its age. A photo the oldest kept dump knew stays with that dump, at any age. With no complete dump at all, photos and `.incoming` files expire at 8 weeks, and unexpired files remain until that deadline.
- The bucket copy also removes files last seen before the oldest kept dump. Empty account and conversation folders are removed. The version index retains identifiers only for files that remain. An empty index is removed.
- Pruning runs before credential renewal and again on exit, including after a failed renewal, dump or bucket sync.
- A bucket file is fetched again when its recorded version changes, even at the same size. The replacement waits in the staging folder until the whole sync succeeds.
- The swap and the new dump are one journalled step. `bucket/pint-drops.commit.json` is written first, each retained photo is moved into `bucket/pint-drops.previous/` rather than overwritten, and publishing the dump is the commit point. A failure before that point puts the retained photos and the version index back. A killed run is finished or undone by the next run before it prunes or reads anything: kept if its dump was published, undone if not.
- With the session pooler, a refused connection right after the temporary login is issued is retried with backoff (1, 2, 4 and 8 seconds), because the pooler can take a moment to learn the new password. A query error, such as a missing grant, is never retried.
- Pruning requires the backup process to run. A killed process, or a sleeping, powered-off or unavailable Mac, can postpone deletion beyond eight weeks. The next run applies the age limit before it requests credentials. Installation does not prove continuous deletion or backup durability.

Keep a second copy off the Mac. A free option is an encrypted archive on a
personal cloud drive. `gpg --symmetric --cipher-algo AES256 <dump>` or an
encrypted disk image both work. Store the passphrase in the password manager,
not beside the file.

### The restore drill (owed to the captain)

Nobody has run one yet. Run it once, then every quarter, and fill in the log.
The automated restore test (see "Targets") is a floor, not a drill. Only this
drill proves a restore into Supabase and measures the RTO.

1. Resume `pubmax-pentest` in the Supabase dashboard. Note its connection string.
2. Restore the newest dump into it, following section 2 steps 2 to 4.
3. Run the checks in section 2 step 5 against it.
4. Time it. Write the figures in the log below.
5. Pause `pubmax-pentest`.

| Date | Dump used | Restore minutes | Checks passed | By | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## 2. Restore the database from a dump

Use when data is lost or corrupt. The target is either the production project
(after the damage is understood and the captain agrees) or a fresh project.

1. Stop the writers. Set the freeze in [`OPS_FREEZE_RUNBOOK.md`](OPS_FREEZE_RUNBOOK.md) so nothing writes while you restore, then redeploy.
2. Pick the newest dump that predates the damage: `ls -1 ~/pubmax-backups/*.dump`. Check it: `pg_restore --list <dump> | head`.
3. Set the target through the standard variables, never on a command line:
   `export PGHOST=... PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGSSLMODE=require` and `read -s PGPASSWORD; export PGPASSWORD`.
4. Restore. On a fresh project, restore everything. On the live project, restore only what was lost:
   - Fresh or empty schema: `pg_restore --no-owner --no-privileges --dbname "$PGDATABASE" <dump> 2> restore.log`, then `grep -A1 'ERROR:' restore.log`. Do not add `--exit-on-error`: a fresh database already has the `public` schema (a fresh Supabase project also has `auth` and `storage`), so the dump's `CREATE SCHEMA` fails at once and nothing is restored. Every error in the log must be one of two kinds, and only on `public`, `auth` or `storage` objects the project already holds: "already exists", or "multiple primary keys for table ... are not allowed" on a table that already has its primary key. Any other error means the restore is not complete. The automated restore test holds this list for the stand-in project, so read its `EXPECTED_RESTORE_ERRORS` first. A real project holds more `auth` and `storage` objects, so its log has more lines of these two kinds.
   - One table: `pg_restore --no-owner --data-only --table <name> --schema public --dbname "$PGDATABASE" <dump>`.
   - After a full restore, run `psql "$PGDATABASE" -v ON_ERROR_STOP=1 -f scripts/db/restore-realtime-policies.sql`. The dump leaves the platform's `realtime` schema out, but migrations `0148` and `0171` put two policies on `realtime.messages`, and the restored migration ledger says both already ran. Without this step no signed-in browser can join private messaging or the Pint Drop channel. The restore proof holds the file equal to the migrated policies.
   Supabase owns objects in `auth` and `storage`. If a restore of those schemas fails on ownership, restore `public` first, then load `auth.users` and `auth.identities` data-only.
5. Check:
   - `select count(*) from auth.users;` is within a few rows of the figure recorded at backup time (20 on 6 October 2026).
   - `select count(*) from storage.objects;` matches the bucket directory's file count (24 on 6 October 2026).
   - `npm run check:migration-ledger` passes against the restored project.
   - `curl https://<host>/api/health` answers 200 with `"database":"ok"` once the app points at it.
6. Restore bucket files: for each file under `bucket/pint-drops/`, upload it to the same path in the `pint-drops` bucket with the dashboard or the Storage API. Keep the bucket private.
7. Lift the freeze, redeploy with `npm run release:prod`, and watch the smoke run.

## 3. Rebuild from zero

Use when the Supabase project, the Vercel project or both are gone. The repository
holds the code, the migrations and every committed dataset, so this path needs
no dump for the application itself. A dump only brings the data back.

1. **Database.** Create a Supabase project in eu-west-2. Apply every file in `supabase/migrations/` in filename order with `supabase db push --include-all` (or the SQL editor). The captain applies migrations. Then `npm run check:migration-ledger` with `SUPABASE_PROJECT_REF` set to the new project.
2. **Data.** Restore the newest dump as in section 2, or accept an empty database and let the harvest and refresh jobs refill the datasets.
3. **Bucket.** Create the private `pint-drops` bucket, then upload `bucket/pint-drops/`. The migration `0021_private_pint_drops_storage` is the policy source.
4. **Auth.** Re-enter the Supabase auth settings the dashboard holds and the migrations cannot: site URL, redirect allow-list (production hosts only), email provider, password rules. Clerk keeps its own settings, see section 5.
5. **Vercel.** Create the project, link it with `vercel link --project <name>`, then set every Production variable named in [`.env.example`](../.env.example). The keys that matter most are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `ADMIN_TOKEN`, `RATE_LIMIT_SALT`, `PLAN_IDEMPOTENCY_SECRET` and the Clerk pair. Salts and secrets can be new values, with the effects in section 5.
6. **Domain.** Add `pubmaxxing.com` and `www.pubmaxxing.com` to the project. See section 6 for DNS.
7. **Release.** `npm run release:prod`. It deploys, promotes and runs the production smoke suite.
8. **GitHub.** Repository secrets: `SMOKE_USER_HANDLE`, `SMOKE_USER_PASSWORD`, `PUBMAX_ALERT_WEBHOOK_URL`, plus the harvest keys the scheduled workflows name. Recreate the smoke account as [`e2e/prod-smoke/README.md`](../e2e/prod-smoke/README.md) describes.
9. **Monitoring.** `.github/workflows/uptime.yml` checks `/api/health` and `/api/version` every five minutes from the default branch, and alerts through the `PUBMAX_ALERT_WEBHOOK_URL` repository secret from step 8. It reads the origin from `PRODUCTION_SITE_ORIGIN` in `lib/siteUrlConfig.mjs`, so a replacement domain (section 6) changes that constant too. Set `PUBMAX_ALERT_WEBHOOK_URL` in Vercel too. An external monitor is optional (see [`DEPLOYMENT.md`](DEPLOYMENT.md) "Uptime monitor").
10. **Backups.** Re-point `PUBMAX_BACKUP_DB_URL` and the bucket variables at the new project and run one backup.

## 4. Account lockout

Each account below has one owner today, which is the risk. Close it before it
bites: add a second owner, store recovery codes in a password manager, and keep
a copy off the device.

| Account | If you are locked out |
| --- | --- |
| GitHub (`Singularityszn`) | Use a recovery code or a registered security key. A second organisation owner can restore access. Without either, GitHub support needs proof of ownership, which takes days. Until then the deployed site keeps running. |
| Vercel (`pubmax69`) | Use the recovery code or sign in with the linked Git provider. A second team owner can reset. The site keeps serving the last promoted deployment. |
| Supabase | Use the recovery code or the SSO provider. A second organisation owner can restore access. Backups on the Mac are the way back to the data. |
| Clerk | Use the recovery code. Sign-in for drinkers fails without the Clerk keys, so a lockout is an incident. |
| Domain registrar (GoDaddy) | Recover through the registered email, then phone. Do this before the domain expires, see section 6. |
| Email behind all of these | The weakest link. Turn on 2FA and a recovery phone. |

While locked out of GitHub: do not rotate anything in a panic. Releases and
backups both need access, so freeze changes and recover the account first.

## 5. A key has leaked

A leaked key is revoked first and replaced second. Any delay in revoking is
exposure, and a short outage while you replace it is cheaper.

### Order

Work down the table. Within a row: revoke at the provider, create the new value,
set it in Vercel Production, redeploy with `npm run release:prod`, confirm
`/api/health` and the smoke run, then update the copy in the password manager and
`keys.env`. Put the date in the rotation table.

| Order | Secret | Why it is here | Side effect of rotating |
| --- | --- | --- | --- |
| 1 | `SUPABASE_SERVICE_ROLE_KEY`, and the database password | Full read and write on every table, bypassing row level security | None for users. Update the backup's service role key. Update `PUBMAX_BACKUP_DB_URL` only in `password` mode. |
| 2 | `CLERK_SECRET_KEY` | Can mint and read sessions | Signed-in users are signed out. |
| 3 | `ADMIN_TOKEN`, `CRON_SECRET` | Admin routes and every mutating scheduled route | Generate with `openssl rand -hex 32`. Vercel cron picks up `CRON_SECRET` on the next deploy. |
| 4 | `PLAN_IDEMPOTENCY_SECRET`, `SOCIAL_CONNECTION_ENCRYPTION_KEY` | Signs proofs and encrypts stored tokens | Open proofs expire. Rotating the encryption key makes stored social tokens unreadable: users reconnect. |
| 5 | `RATE_LIMIT_SALT`, `ACTOR_HASH_SALT`, `PLAN_MEMBER_TOKEN_SALT`, `PLAN_INVITE_TOKEN_SALT` | Hash salts | Rate-limit buckets reset. `ACTOR_HASH_SALT` changes every stored actor hash, so past reactions lose their owner. `PLAN_*` salts break outstanding invite and member links. Rotate only on evidence of leak. |
| 6 | Paid vendor keys: `ELEVENLABS_API_KEY`, `OPENROUTER_API_KEY`, `TYPESAFE_API_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`, `ELEVENLABS_LLM_SHARED_SECRET` | Money. Set a monthly cap in each vendor dashboard as well | None for users. |
| 7 | Push and mail: `APNS_PRIVATE_KEY`, `FCM_PRIVATE_KEY`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY` | Sends as the app | Rotating `VAPID_PRIVATE_KEY` drops every web push subscription. |
| 8 | Data vendors: `TAVILY_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `TICKETMASTER_API_KEY`, `GOOGLE_PLACES_API_KEY` and the rest in `.env.example` | Quota only | None. |
| 9 | `SUPABASE_ACCESS_TOKEN` (ledger check and `cli-read-only` backup login), GitHub personal tokens, the Vercel token, `PUBMAX_ALERT_WEBHOOK_URL` | Operator access | Re-create in the vendor, update the environment that runs the backup and the repository secret. |

### If it was committed

Rotating is not enough: the value stays in git history. Rotate first, then run
`gitleaks git` over the full history, and if the secret is in a public commit
treat it as public for ever. Never rewrite `main` to hide it.

### Rotation table

Fill this in at every rotation. A blank date means "never rotated".

| Secret | Last rotated | By | Reason |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | | | |
| `CLERK_SECRET_KEY` | | | |
| `ADMIN_TOKEN` | | | |
| `CRON_SECRET` | | | |
| `ELEVENLABS_API_KEY` | | | |
| `OPENROUTER_API_KEY` | | | |
| `PUBMAX_ALERT_WEBHOOK_URL` | | | |

## 6. Domain loss

The site is reachable by name only through `pubmaxxing.com`. Losing the name
loses every link, every share card and the app's origin.

Prevention, once:

- Turn on auto-renew on both domains and put the expiry dates in the calendar.
- Turn on registrar 2FA and registrar lock. Keep the recovery path in the escalation list.
- Add a CAA record that allows only the certificate authority Vercel uses.

If the domain is lost or expired:

1. Check the registrar. An expired domain is usually recoverable during the grace period, often with a fee. Pay it. Do nothing else first.
2. If the registrar account is lost, recover it per section 4. If the domain is hijacked, contact the registrar's abuse line with proof of ownership and say that the name hosts a live service.
3. While it is down, the app still answers on its Vercel URL. Set `NEXT_PUBLIC_SITE_URL` only after a replacement domain is settled, and redeploy.
4. Replacement domain: buy it, add it to the Vercel project, point DNS at Vercel, set `NEXT_PUBLIC_SITE_URL`, add it to the Supabase auth redirect allow-list and the Clerk allowed origins, then run `npm run release:prod`. The native apps load the web origin, so read [`ios/AGENTS.md`](../ios/AGENTS.md) and [`android/AGENTS.md`](../android/AGENTS.md) before changing it.
5. Redirect the old name to the new one if it comes back.
