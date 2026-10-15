# Hide one Pint Drop from public view

How an operator takes a single Pint Drop off every public surface without
deleting it. The row stays in `public.pint_drops` as a Hidden Pint Drop
(`CONTEXT.md`) and comes back with one call. A pint priced from the venue
sheet also wrote a paired community price, which is a separate record with
its own hide; step 1 finds it and step 2 hides it too. Nothing in this
runbook adds a table, a column or a migration: it uses the moderation state
that already exists.

Agents do not run these steps against production. The captain or an operator
with the admin token or the Supabase SQL editor does.

## The mechanism

A Pint Drop has one moderation column, `status`, with three values:
`visible`, `hidden` and `pending` (`lib/pintDropShared.ts`). Only `visible`
reaches a reader. The moderator decision is `POST /api/pint-drops` with
`action: "keep_hidden"` (or `"restore"` to undo), gated by `isModerator`
(`lib/adminAuth.ts`: the `x-admin-token` header or the admin session cookie).
On the durable store it is one update, in `supabasePintDropStore.moderate`
(`lib/pintDropsStore.ts`):

```
status = 'hidden', moderated_at = now(), moderator_note = <note, if given>
where id = <drop id>
```

The API applies that to whatever status the row has, and keeps the previous
note when none is sent. The SQL in step 2 adds a `status = 'visible'` guard
the API does not have, so check the status in step 1 before using either.

A one-tap price from the venue sheet (`POST /api/price-submit`, a pint of
beer) writes a `public.community_prices` row first and then the paired Pint
Drop (`lib/oneTapPintDrop.server.ts`). Nothing links the two rows by id, and
the community price has its own hide: `hidden_at`, set by
`POST /api/admin/community-prices` with `action: "hide"`, which also
re-syncs the price-trust credit (`app/api/admin/community-prices/route.ts`).
Hiding the Pint Drop leaves that price public, so both are hidden.

`/admin` only lists Pint Drops that are already in a queue (reported, hidden,
pending, confirmed), so a drop nobody has reported needs its id looked up
first (step 1) and the action sent directly (step 2).

## Every public Pint Drop read already filters on `status`

Audited on 15 Oct 2026 against `main` at `9d7a17c`. No Pint Drop surface
reads around it. The paired community price is a different record, covered
above.

| Surface | Read path | Filter |
| --- | --- | --- |
| Map venue sheet, Pints tab | `components/map/usePintDrops.ts` to `GET /api/pint-drops?venueId=` to `listVisible` | `.eq("status", "visible")` |
| The Golden Thread | `components/map/VenuePriceStory.tsx`, fed the same `drops` as the Pints tab | same read as above |
| Feed, landing strip, borough slice, profile | `GET /api/pint-drops` (unscoped, `?author=`, `?city=`) to `listVisible` | `.eq("status", "visible")` |
| Stories (crawl recap `/recap/[storyId]`) | `pintDropsStore().listVisible` | `.eq("status", "visible")` |
| Contributor stats | `GET /api/pint-drops/stats` to `listVisible` | `.eq("status", "visible")` |
| Permalinks (`/ledger/[id]`, `/bar-tab/[id]`, OG image) | `lib/pintDropLookup.ts` | `.eq("status", "visible")`, else the not-found state |
| Confirmed prices, price missions, pin colour | `listConfirmedDrops`, `listConfirmedVenueIds`, `listConfirmationCandidates` | `.eq("status", "visible")` |
| Direct Supabase reads by a signed-in client | RLS `pint_drops_public_surface_select` | `rls_can_read_visit_report` requires `status = 'visible'`; `anon` is denied |

`GET /api/pint-drops` answers `no-store`, so there is no CDN copy to purge. A
browser that already has the venue sheet open keeps the drop on screen until
its next read of the list.

Regression pin: `__tests__/pintDrops.test.ts`, "operator hide of an unreported
Pint Drop (runbook)".

## Procedure

### 1. Find the rows (read only)

In the Supabase SQL editor for the production project, the Pint Drop:

```sql
select id, venue_id, handle, drink, price_gbp, status, visibility, provenance,
       created_at, confirmation_id, confirming_drop_id,
       report_count, moderated_at, moderator_note
  from public.pint_drops
 where lower(ltrim(btrim(handle), '@')) = '<handle>'
   and drink ilike '<drink>'
   and price_gbp = <price>
   and created_at >= timestamptz '<yyyy-mm-dd> 00:00 Europe/London'
   and created_at <  timestamptz '<yyyy-mm-dd + 1> 00:00 Europe/London'
 order by created_at;
```

Do not filter on `venue_id`: a drop can be stored under a legacy alias of the
canonical venue id (`lib/storedVenueRef.ts`), so read it off the result
instead. Expect exactly one row with `status = 'visible'`. Write down its
`id`, `venue_id` and current `moderator_note`. If there are none or several,
or the status is not `visible`, stop and ask: the API would overwrite a
`pending` or report-hidden row's moderation state.

Then the paired community price, if there is one:

```sql
select id, venue_id, drink_category, price_pennies, contributor_handle,
       submitted_at, hidden_at, moderated_at, moderator_note
  from public.community_prices
 where venue_id = '<venue_id from the Pint Drop row>'
   and lower(ltrim(btrim(contributor_handle), '@')) = '<handle>'
   and drink_category = 'beer'
   and price_pennies = <price in pennies>
   and submitted_at between timestamptz '<drop created_at>' - interval '5 minutes'
                        and timestamptz '<drop created_at>' + interval '5 minutes';
```

A one-tap price lands within seconds of its drop. Zero rows means the drop
came from the Pint Drop composer alone and there is nothing else to hide. One
row with `hidden_at` null is the pair: write down its `id`. Several rows:
stop and ask.

If `confirmation_id` is set on the Pint Drop, it was confirmed with a second
drop (`confirming_drop_id`). Hiding this one leaves the other drop and its
confirmation as they are, so the price can still read confirmed on the pin.
Decide about the other drop separately.

### 2. Check it is public now

The step 3 check only means something if the same read shows the rows first:

```sh
curl -sS 'https://pubmaxxing.com/api/pint-drops?venueId=<canonical venue id>' | grep -c '<drop id>'
curl -sS 'https://pubmaxxing.com/api/price-submit?venueId=<canonical venue id>' | grep -c '<price id>'
```

Each prints `1`. A `0` for the drop means it is not public on that read (a
`friends` or `legacy` visibility, or the wrong venue id): stop and find out
why before hiding anything.

### 3. Hide them

Use the admin actions. They are the code paths `/admin` uses, so they log
the decision, and the community price route also re-syncs price trust,
which no SQL here does. `ADMIN_TOKEN` is the production value from the
Vercel project, exported in the operator's own shell; never paste it into a
ticket or a PR.

```sh
curl -sS -X POST 'https://pubmaxxing.com/api/pint-drops' \
  -H 'content-type: application/json' \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"action":"keep_hidden","id":"<drop id>","note":"<why, who asked, date>"}'

curl -sS -X POST 'https://pubmaxxing.com/api/admin/community-prices' \
  -H 'content-type: application/json' \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"action":"hide","id":"<price id>","note":"<why, who asked, date>"}'
```

`200 {"ok":true}` means the row changed. `404` means no row has that id.
`403` means the token is wrong. A `503` from the Pint Drop route means
nothing changed. A `503` naming trust reconciliation from the price route
means the price is hidden but its trust credit is not: send
`{"action":"reconcile","id":"<price id>"}` to the same route.

SQL for the Pint Drop, only if the API is down. It touches one row and
refuses a row that is not currently visible:

```sql
begin;
update public.pint_drops
   set status = 'hidden',
       moderated_at = now(),
       moderator_note = '<why, who asked, date>'
 where id = '<drop id>'
   and status = 'visible'
returning id, status, moderated_at, moderator_note;
-- Exactly one row back: commit. Anything else: rollback.
commit;
```

Do not hide the community price by SQL: setting `hidden_at` alone leaves its
trust credit standing. Wait for the API, or follow up with `reconcile`.

### 4. Check it

```sh
curl -sS 'https://pubmaxxing.com/api/pint-drops?venueId=<canonical venue id>' | grep -c '<drop id>'
curl -sS 'https://pubmaxxing.com/api/price-submit?venueId=<canonical venue id>' | grep -c '<price id>'
```

Both now print `0`. Confirm the stored state in SQL rather than through the
moderator queue, which lists only the newest 500 hidden drops:

```sql
select id, status, moderated_at, moderator_note from public.pint_drops where id = '<drop id>';
select id, hidden_at, moderator_note from public.community_prices where id = '<price id>';
```

Then open the pub on the map and check the Pints tab, the Golden Thread and
the community price row.

### Undo

```sh
curl -sS -X POST 'https://pubmaxxing.com/api/pint-drops' \
  -H 'content-type: application/json' \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"action":"restore","id":"<drop id>","note":"<why restored>"}'

curl -sS -X POST 'https://pubmaxxing.com/api/admin/community-prices' \
  -H 'content-type: application/json' \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"action":"restore","id":"<price id>","note":"<why restored>"}'
```

`restore` cannot clear a note, only replace it, so send one saying why. To
put the Pint Drop's original note back exactly (the value from step 1), use
SQL:

```sql
update public.pint_drops
   set status = 'visible', moderated_at = now(), moderator_note = <previous note or null>
 where id = '<drop id>' and status = 'hidden'
returning id, status;
```

## What stays true after a hide

- The rows, their photos and their report trail stay in the database. Pint
  Drop photos are not signed for public readers while the row is hidden.
- A later report on the drop puts it back in the moderator queue and clears
  `moderated_at` and `moderator_note` (migration 0116), but never makes it
  visible again. Only `restore` does.
- A hidden drop does not count toward the contributor's public stats or
  passport, and cannot be confirmed by a later Second Drinker, because every
  one of those reads asks for `status = 'visible'`.

## Log

| Date | Drop | Venue | Reason | Done by |
| --- | --- | --- | --- | --- |
| Pending | `tester`, Hatton Lager, £4.50, logged 1 Sep 2026, plus its paired community price if step 1 finds one | The Sir Christopher Hatton, 4 Leather Ln, EC1N 7RA (`venue-1vle947`) | Owner asked for it to be hidden, not deleted | Operator, not yet run |
