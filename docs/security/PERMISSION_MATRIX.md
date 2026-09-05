# Permission matrix

What each actor may do with a private Plan, a private Moment and its upload
object, a price observation and its confirmation, moderator actions and
account deletion. The executable owner is
`__tests__/permissionMatrixEffective.test.ts` (run by `npm run test:rls`): it
boots PostgreSQL 16 plus PostgREST, applies every migration in production
order, and asserts every cell below at the API route and, where a browser JWT
could reach the table, at the table. Change a policy and change this file in
the same commit.

## Actors and doors

| Actor | How it reaches the app |
| --- | --- |
| anonymous | no bearer, or the anon key alone |
| user A (alice) | her Supabase access token; owns everything private below |
| user B (bob) | his Supabase access token; an unrelated signed-in account |
| capability | a Plan member token or invite token, which is not an identity |
| moderator | the `ADMIN_TOKEN` credential, never ownership |

Two doors. The API route runs through the service-role client and gates in
code. The table is what a browser JWT can read through PostgREST, gated by RLS.
The service role never reaches a client path.

## Cells

Allowed means the actor gets the private data or the write lands. Denied means
the honest refusal for that route (401, 403, 400 or 409) and no change.

| Cell | anonymous | user B | user A | capability |
| --- | --- | --- | --- | --- |
| Public venue evidence (`/api/venue/[id]`, visible drops and prices) | allowed | allowed | allowed | n/a |
| Read A's Plan (`GET /api/plans/[id]`, getin, recap) | preview only | preview only | preview only with a bare account bearer | host or guest member token: member state |
| Read A's Plan at the table (`plans`, `plan_stops`, `plan_crew_members`) | denied | no rows | own rows | seat bound to an account: rows while the seat is live |
| The seat token column (`plan_crew_members.token_hash`) | denied | denied | denied | denied |
| Edit A's Plan (`PATCH` stops, invite rotate, presence) | denied | denied | denied with a bare bearer | host token only; a guest may not rotate |
| Plan writes at the table | denied | denied | denied | denied |
| Invite acceptance (`POST /api/plans/[id]/join`) | invite required | one seat per account, spent invite refused | n/a | invite token as a bearer: preview and no edit |
| Removed member | n/a | preview at the route and no rows at the table, immediately | n/a | revoked token: preview, presence refused |
| Unfurler (`/api/plan-card`) | PNG from the preview only | same | same | same |
| List Night Memories (`GET /api/night-memories`) | 401 | own only | own only | n/a |
| A's Moments (`GET /api/night-memories/[id]/moments`) | 401 | empty list | own rows | n/a |
| Add a Moment to A's Memory | 401 | denied | allowed | n/a |
| Describe A's photo Moment (`PATCH alt-text`) | 401 | 403 | allowed | n/a |
| `night_moments` at the table | denied | no rows, no writes | own rows, no writes | n/a |
| A's upload object (`storage.objects` and the bucket paths) | invisible | invisible | invisible; only a server-minted signed URL serves it | n/a |
| Log a price (`POST /api/price-submit`, `POST /api/pint-drops`) | 401 | allowed under own actor | allowed under own actor | n/a |
| Confirmation | n/a | independent second report confirms | own repeat is `same_reporter`, never a confirmation | n/a |
| Edit own price observation | n/a | newer-wins under own actor | newer-wins under own actor | n/a |
| Edit another's price row at the table | denied | denied | denied | n/a |
| Hidden rows and `actor` or `hidden_at` columns at the table | denied | denied | denied | n/a |
| Moderator confirm, restore, review lanes, hide a price | 403 | 403 | 403 | `ADMIN_TOKEN` only |
| Delete account (`DELETE /api/account`) | 401 | own account only, whatever the body names | own account only | n/a |
| Export account data | no route exists | no route exists | no route exists | n/a |

## Findings from the first run

1. **A removed Plan member kept table-level SELECT** on the Plan, its stops
   and its crew through PostgREST for as long as the revoked seat still carried
   the account id. Migration `0070` moved every RLS helper into
   `pubmax_private` and the three Plan policies read
   `pubmax_private.rls_is_plan_participant`; migration `0124` then re-declared
   the helper with the `membership_revoked_at` check in `public`, a second
   function no policy calls. The API door was closed. Migration `0144` writes
   the check into the helper the policies read and drops the stray copy, which
   was also an exposed RPC in the public schema (the live isolated project
   answered `POST /rest/v1/rpc/rls_is_plan_participant` to the anon key).
2. **Refusals for a foreign Plan write read as 400** rather than 403 on the
   `PATCH` and presence routes, because validation and the capability lookup
   share one store result. Denied is denied; the matrix asserts 400 or 403.
3. **Account deletion takes the bearer alone.** The audit's expected policy
   names a reauthenticated owner; the route deletes the account the verified
   bearer names and reads no target from the body. Recorded as a policy
   question, not changed here.
4. **No data export route exists.** The cell is not applicable.

## Live check, isolated project

Read-only probe on the isolated `pubmax-pentest` project (2026-09-05), with the
anon key and the two seeded accounts' own sessions: the private Moment object
answered `NoSuchKey` on the public, authenticated and plain object paths and an
empty list on the bucket for anonymous, owner and stranger alike, and no client
could mint a signed URL for it. `night_moments` answered the owner's rows alone.
