# Realtime test follow-up, 22 October 2026

The authenticated live proof remains incomplete at `02386a078c7cb9fc69247b1cf763d7699b78b8ab`.
The focused tests pass. This phase found a missing browser executable, not a reproduced runtime defect.
No runtime source or permanent test changed.

## Fresh checks

The command below passed with two test files and 22 tests.

```sh
node node_modules/vitest/vitest.mjs run __tests__/realtimeAuthLifecycle.test.ts __tests__/realtime.test.ts
```

Those tests use a controlled transport. They do not prove hosted Realtime authorization.
This phase did not run the full verifier, linters, static analysis, builds, or other pipeline phases.
The supplied earlier full-verifier pass remains historical evidence.

Read-only connected checks confirmed these prerequisites:

- Supabase project `iankajxliutqogqkmvdg` reports `ACTIVE_HEALTHY`.
- The existing dedicated QA address pattern matches one account.
- The connected `chengdu` project provides development client and server configuration.

Private values remained in process memory. This phase saved no credentials or session tokens.
The browser failed before link generation or authentication. No email, account, session, broadcast, or product write occurred.

## Missing prerequisite

Provide a Chromium executable compatible with the installed Playwright revision 1248 through an allowed repository-local path.
The default headless launch failed because its executable was absent:

```text
/Users/karanmanoharan/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell
```

The supported `channel: "chromium"` launch also failed because its executable was absent:

```text
/Users/karanmanoharan/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
```

Both launch checks exited with code 1. No browser download, host search, or system change followed.
The previous Docker and Colima setup does not establish a hosted-service blocker in this phase.

## Minimal scenario after the prerequisite is available

1. Load the actual browser client and `subscribeToNewDrops` in a fresh browser context.
2. Keep one subscription mounted for the entire scenario.
3. Confirm signed-out polling after 30 seconds and zero private joins.
4. Generate a private magic link for the confirmed existing QA account, without sending email or creating an account.
5. Verify that link through the real client against hosted Auth.
6. Confirm one private `live:pint-drops` join reaches `SUBSCRIBED` with the current session token.
7. Refresh the session through the SDK and confirm the refreshed token reaches the same channel without another join.
8. Sign out with local session scope and confirm channel removal and resumed polling.
9. Invoke retained signal and status callbacks after sign-out and confirm no signal delivery or channel recovery.
10. Remove the subscription, close the browser, and remove temporary files.

Observe tokens only in memory. Record boolean comparisons, event names, counts, and channel statuses.
Inject a private-looking sentinel into the registered signal callback and require zero callback arguments before sign-out.
Repeat that injection during sign-out and after removal. Require no additional callback delivery.
These injections test callback rejection. They do not prove delivery of a newly created Pint Drop through hosted Broadcast.
Do not send a production Broadcast or create a Pint Drop to obtain this evidence.
The minimal module scenario also does not prove the rendered login screen or cross-user data isolation.

The documented authentication interfaces are [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink),
[verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), and
[refreshSession](https://supabase.com/docs/reference/javascript/auth-refreshsession).

## Separate publication handoff

The outer executor owns publication and branch custody. This test phase did not split, commit, push, open PRs, or merge.
The installed no-mistakes skill documents custody recovery. It does not document an atomic split operation.
Do not invent such an operation or publish this combined branch to obtain separate PRs later.

1. Preserve the current combined head and every pipeline fix under their existing owner.
2. Keep the combined run unpublished while the outer executor resolves its result.
3. After a terminal result, inspect `branch_sync` and follow its exact `next_action.command` if custody recovery is required.
4. After custody returns, create separately owned branches and worktrees from the approved base.
5. Transfer the feature commits and the required integration changes listed below.
6. Validate each resulting head through its own complete gate before publication.

The base for this run is `184eabedd59f91f399f458e8413577a936f263a1`.
Any later base requires reconciliation and fresh validation.
The owner must perform transfers outside this test phase and its worktree.
The current head and its gate fixes must remain preserved throughout that work.

| Separate change | Source commit | Integration changes that must travel with it |
| --- | --- | --- |
| Feedback | `8b62369418d1d3b3cdb0acac6b28ede862cc2eb9` | Keep only the feedback account link. Transfer its sitemap row and assertions from the updates commit. Transfer its measured budget row and performance documentation. |
| Updates | `24405d7f83b03c87fbb20360ce9903d8555db611` | Transfer the account Updates link from the feedback commit. Remove feedback-specific sitemap and budget additions. Keep the semantic sitemap path checks and the released-note date assertion. |
| Request-cap warnings | `3201c38383c82563c47a9ec2f63798c16595ee7d` | Carry the unambiguous rate-limit column wording from `02386a078`. Carry the read-only deployed-limiter evidence from `abb308058`. |
| Realtime | `3449404bd05037f3f04b7da173d134ed106f796d` | Keep the lifecycle tests and their evidence limits. Keep authenticated hosted proof unresolved until the actual scenario passes. |

The two page branches each add one route to this base, so each needs a 49-route budget inventory.
Each also adds one sitemap hub, so each needs 18 static hubs on this base.
When both pages are present, the corresponding counts are 50 routes and 19 static hubs.
Keep the nearby inventory comments and performance documentation consistent with each branch.
Do not copy the combined counts into either independent page branch.

Allocate each page's proof from `e37e15094`, measurements from `844e3f238`, and captures from `926890593` to its branch.
Those receipts identify the historical combined build. They do not validate the newly separated heads.
Shared account, sitemap, and budget files require reconciliation when the second page branch reaches the approved base.
The owner must validate that resulting head again before publication.
No evidence in this report approves, skips, or waives the authenticated Realtime requirement.
