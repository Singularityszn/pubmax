---
name: pubmax-supabase
description: PubMaxxing's own Supabase conventions. Use when writing a store, a migration, an RLS policy, a Realtime channel or auth code in this repo (lib/*Store.ts, lib/supabase.ts, lib/authServer.ts, supabase/migrations). Read with the vendored `supabase` skill, which covers the platform in general.
---

# Supabase in PubMaxxing

The vendored `supabase` skill explains the platform. This skill says how this repo uses it. The rules live in `supabase/AGENTS.md` and in `docs/security/PERMISSION_MATRIX.md`. Read them before you change SQL or a store.

## Two clients, two jobs

- `lib/supabase.ts` is the server-only admin client. It uses the secret key and bypasses RLS. Stores get it from `requireSupabaseAdmin()`.
- `lib/authClient.ts` is the browser client. It uses the publishable key, and it only establishes a session. It never reads or writes app tables.
- The browser sends its access token as a bearer header. A route resolves it with `callerUserId` or `callerAuthIdentity` in `lib/authServer.ts`.

All writes go through a route handler and the admin client. RLS is the second line of defence, not the write path.

## Stores

- A store picks its backend with `selectStore(memory, supabase)` from `lib/storeBackend.ts`.
- With no keys, the app runs on in-memory stores. In deployed production, `selectStore` refuses the memory fallback and throws.
- The admin client is typed by `types/database.ts`. Regenerate it with `npm run db:types`. `npm run db:types:check` runs in `npm run verify`.

## Migrations

The captain applies migrations. Agents write SQL only. Never apply a migration to production.

1. Take the next free four-digit label from `ls supabase/migrations`.
2. Name the file `<14-digit timestamp>_<label>_<name>.sql`.
3. Write its rollback in `supabase/migrations/rollback/` with the same label and a `_rollback.sql` suffix. State in its header what the rollback costs.
4. Make a new column additive. Make the app work before the apply and after it.
5. Prove the change on real PostgreSQL with an `*MigrationEffective.test.ts` suite under `npm run test:rls`.

`__tests__/migrationVersions.test.ts` refuses a duplicate label or a missing rollback.

## RLS and helpers

- RLS helper functions live in the `pubmax_private` schema. Redefine a helper there, never in `public`. `__tests__/rlsHelperSchema.test.ts` holds this.
- Do not reopen `using (true)` on a private table.
- A new access rule widens the one permission matrix. `__tests__/permissionMatrixEffective.test.ts` proves each cell at the route and at the table.

## Realtime

This repo uses two kinds of channel. Find out which kind you are changing before you change its authorization.

- A Broadcast channel is private on both halves. The server sends with `private: true` and the browser subscribes with `{ config: { private: true } }`. A `realtime.messages` policy is the gate. Send an empty payload and let the client refetch through the filtered route. Examples: `lib/messagesBroadcast.server.ts`, `lib/messagesRealtime.ts`, `lib/pintDropsBroadcast.server.ts`, `lib/realtime.ts`.
- A `postgres_changes` channel is authorized by RLS on its table, not by a `realtime.messages` policy. Example: `lib/crewRealtime.ts`, which RLS on `plan_crew_members` gates.

## Rate limits

`isLimited` in `lib/pintDrops.ts` uses the durable limiter `checkRateLimitDurableDetailed` in `lib/supabase.ts`. Pass `failClosed: true` when an outage must refuse rather than allow, as `lib/paidSpendBudget.server.ts` does.
