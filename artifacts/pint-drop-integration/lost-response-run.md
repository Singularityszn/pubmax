# Lost 201 receipt proof

Status: prepared source only. No runtime proof exists from this driver yet.

Base: `f9f885edccf36c2c22e99e74a4fabefdeae444ae`.
Driver: `lost-response-proof.mjs` in this directory.
Run it from the repository root. It imports the original `BILL_FIXTURE` and `attachSpillBill` helper.
It uses the full composer at 390x844. It does not use the general Playwright configuration.

## Prepare the local stack

The runtime owner must provide the separate execution window.
Follow `/tmp/pubmaxx-receipt-local-run.md` for local services, migrations, build, and teardown.
The integration handoff is currently untracked in the original integration worktree:
`/Users/karanmanoharan/Documents/projects/pubmaxx-pint-drop-integration/artifacts/pint-drop-integration/handoff.md`.

Use one disposable local Supabase project with real GoTrue, Storage, PostgREST, and PostgreSQL.
Apply the integrated migration chain through 0157. Keep the retained receipt columns from 0153.
Prepare one fresh Auth account with a password, owned profile handle, and adult eligibility.
This account must have no Pint Drops. The driver refuses existing rows and performs no cleanup.
Create the private `pint-drops` bucket. Do not run other writers against this disposable stack during proof.

Build and start the exact source with explicit local public and server Supabase credentials.
Disable `PUBMAX_E2E_KEYLESS`. Keep external provider credentials empty.
Confirm the build's public Supabase URL and the server's Supabase URL match the local input below.
Do not use the default keyless Playwright server. The driver starts only its own browser.

Capture the local Storage container's JSON stdout continuously into a new mode-0600 file.
Use `docker logs --follow --since <capture-start-time> <owned-storage-container>` with the owned local Docker socket.
Redirect stdout and stderr to protected files. Never print raw Storage logs: they can contain request headers.
Do not add Docker timestamps or a terminal prefix to JSON stdout.
Keep this capture process running until the driver exits.

The driver reads completed requests with `req.method`, `req.url`, and `res.statusCode`.
It requires two successful initial object uploads as a positive check of this log format.
It also requires later successful reads to show the log stream has advanced after replay.
Storage's `download` filename labels each independent read phase. Earlier read logs cannot satisfy the later phase.
Missing logs or a changed log format fail the proof. Do not replace this check with final object counts.

## Protected inputs

Create one JSON file outside Git. Its permissions must be 0600, and the current user must own it.
Set these fields without printing their values:

| Field | Value |
| --- | --- |
| `appUrl` | Loopback Next origin, including the assigned port |
| `apiUrl` | Loopback Supabase API origin, including the assigned port |
| `databaseUrl` | Local PostgreSQL URL with user, password, port, and database |
| `anonKey` | Local public Supabase key |
| `serviceRoleKey` | Local service key, used only for private Storage reads |
| `handle`, `password` | Fresh local account credentials |
| `expectedCommit` | Exact 40-character commit reported by the built app |
| `storageLogFile` | Absolute path to the protected live Storage log |
| `outputDirectory` | New absolute path outside Git; it must not exist |
| `bypassCSP` | Boolean; normally false |
| `cspException` | Required explanation when `bypassCSP` is true |

Only `127.0.0.1`, `::1`, and `localhost` endpoints are accepted. DNS results must also be loopback.
Endpoint queries and fragments are refused. API and app origins cannot contain credentials or path prefixes.
PostgreSQL uses a direct read-only `psql` connection. Its password stays in the child process environment.
No configuration is read from the linked Supabase project or the repository's environment files.

The local production CSP may refuse local GoTrue transport. If necessary, explicitly set `bypassCSP: true`.
Record the reason in `cspException` and the run ledger. This exception does not prove production CSP behavior.
The output labels bypassed CSP. It never changes application policy.

## Execute later

Use the installed lockfile dependencies, Chromium, and `psql` prepared by the runtime owner.
Clear `DEBUG`, `PWDEBUG`, and `NODE_USE_ENV_PROXY`. Do not enable tracing or shell command tracing.

```sh
node --import tsx artifacts/pint-drop-integration/lost-response-proof.mjs /absolute/protected/receipt-input.json
```

The driver signs in through the actual handle-password form.
It checks the issued session against local GoTrue and the independently read SQL profile owner.
Only POST `/api/pint-drops` receives an interception. All other application requests use their real handlers.
Each intercepted POST calls `route.fetch` with `maxRetries: 0` and redirects disabled.

Before aborting the first delivery, the driver requires the actual upstream 201 and drop ID.
Independent SQL must show one ledger row, one account drop, matching price, and both stored photo keys.
Both photos must download through real Storage and decode. Initial upload log records must match their keys.
Only then does the driver abort delivery of that committed success.

The composer must retain the price, drink, and decoded bill preview, with no premature map row.
One real `Log it` click performs the retry. No API retry substitutes for that action.
The driver compares the request key, every FormData field, original File identities, metadata, and actual File bytes.
Both attached Files must equal the original `BILL_FIXTURE` bytes before fetch.

The retry must return another real 201 with the same drop ID.
SQL ledger, drop, and Storage object snapshots must remain unchanged.
Downloaded photos must retain their hashes and dimensions. Stored JPEGs need not equal original upload bytes.
Storage logs must show no further upload or delete request. Final object counts alone do not satisfy this condition.
Signed-URL and list POST requests remain allowed because they read objects rather than upload bytes.
The composer must close, with one optimistic record, no retry payload, and one matching map row.
Both stored photos must also decode in that map row.

## Retained evidence and limits

The new output directory receives `proof.json` and two 390px screenshots.
The JSON retains bounded reply projections, SQL results, file hashes, Storage request summaries, and exact `/api/version` replies.
It excludes sessions, API keys, passwords, raw request headers, signed photo URLs, and original image bytes.
The screenshots show only the disposable account's composer and resulting row.

Failures retain the fixed stage label and completed evidence. Raw errors are deliberately not printed.
Do not interpret a failed log reader, missing prerequisite, or local CSP exception as successful proof.
The driver neither proves receipt moderation nor synthesizes an accepted receipt verdict.
This case proves one committed-response loss and replay. It does not establish broader production availability.

The driver closes its own browser. The runtime owner stops the owned app, log capture, and local stack.
Keep protected inputs and raw logs outside Git. Remove them after review and the required evidence capture.
Do not use account teardown to infer application deletion behavior.
