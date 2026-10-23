# Realtime auth lifecycle proof, 20 October 2026

This record describes local controlled evidence at base `184eabedd59f91f399f458e8413577a936f263a1`.
It does not establish the cause of the production Realtime errors.

## Reproduced behaviour

The real browser client, Supabase SDK, and Pint Drop subscription ran against synthetic auth responses and a controlled WebSocket transport.
No request left the test process.

Before the change, a signed-out mount sent one private join that the transport refused as `Unauthorized`.
The mount then polled every 30 seconds.
Signing in during that mount left the subscription on polling until a remount.
A mount that overlapped sign-in also remained on polling in the controlled scenario.

An authenticated remount sent the current token and received payload-free signals.
The SDK updated the token after `refreshSession` and cleared authentication after sign-out.
These cases did not reproduce a token propagation defect.

The first lifecycle run passed all three baseline cases, including message thread and inbox checks.
The stronger recovery expectations failed on unchanged source with two failures:

```text
Test Files  1 failed (1)
Tests       2 failed | 2 passed (4)
anonymous refusals: expected 0, received 1
overlapping sign-in joined with current token: expected true, received false
```

## Result after the change

`lib/realtime.ts` uses the SDK's auth events to select the delivery mode.
A signed-out mount polls without opening a private channel.
Sign-in attaches the channel without a remount.
The SDK continues to own channel tokens and token refresh.
Sign-out removes the channel and restores polling.

The helper also polls while the lazy client loads.
Cleanup removes the auth listener, channel, and timers.
An authenticated channel refusal keeps the existing poll fallback.
Token refresh does not start repeated joins after that refusal.
Private channel configuration and payload-free signals remain covered by executable tests.

The real-SDK proof covers these cases:

- A signed-out mount, sign-in, token refresh, and sign-out.
- An authenticated message thread across token refresh and sign-out.
- An authenticated inbox across token refresh and sign-out.
- A Pint Drop mount that overlaps sign-in.
- Sign-in while the previous channel is still leaving.
- An authenticated refusal followed by token refresh.

Focused helper tests also cover delayed client loading, cleanup before loading, queued auth events after cleanup, and stale signal callbacks.

## Checks

```sh
npx vitest run __tests__/realtimeAuthLifecycle.test.ts __tests__/realtime.test.ts __tests__/messagesRealtime.test.ts __tests__/crewRealtime.test.ts
```

```text
Test Files  4 passed (4)
Tests       46 passed (46)
```

```sh
npx eslint lib/realtime.ts __tests__/realtime.test.ts __tests__/realtimeAuthLifecycle.test.ts
```

ESLint exited with code 0 and no warnings.
A scoped TypeScript check included the changed modules and their imported dependencies. It exited with code 0.
The coordinator owns the combined full verification and production build.

## Limits

The supplied production audit counted 80 `Unauthorized` Realtime error records.
This proof does not attribute those records to anonymous Pint Drop joins.
It does not connect them to the separate `bad_jwt` refusals or SQL cancellation.

The transport models authorization outcomes rather than running Supabase Realtime or production RLS.
This proof exercises SDK auth methods and subscription delivery, not the rendered sign-in screen or a device browser.
No credentials, live test accounts, production writes, migrations, or provider changes were used.
No deployment or production error reduction is claimed.
