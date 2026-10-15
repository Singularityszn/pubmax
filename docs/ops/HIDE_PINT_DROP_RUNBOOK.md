# Hide one Pint Drop from public view

How an operator takes a single Pint Drop off every public surface without
deleting it. The row stays in `public.pint_drops` as a Hidden Pint Drop
(`CONTEXT.md`), stays in the moderator queue, and comes back with one call.
Nothing in this runbook adds a table, a column or a migration: it uses the
moderation state that already exists.

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

`/admin` only lists drops that are already in a queue (reported, hidden,
pending, confirmed), so a drop nobody has reported needs its id looked up first
(step 1) and the action sent directly (step 2).

## Every public read already filters on `status`

Audited on 15 Oct 2026 against `main` at `9d7a17c`. No surface reads around it.

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

### 1. Find the row (read only)

In the Supabase SQL editor for the production project:

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
instead. Expect exactly one row with `status = 'visible'`. Write down its `id`
and its current `moderator_note` (the undo puts it back). If there are none or
several, stop and ask.

If `confirmation_id` is set, the drop was confirmed with a second drop
(`confirming_drop_id`). Hiding this one leaves the other drop and its
confirmation as they are, so the price can still read confirmed on the pin.
Decide about the other drop separately; this runbook hides one row.

### 2. Hide it

Preferred, the admin action (the same code path `/admin` uses, so it logs and
stamps the decision like any moderator call). `ADMIN_TOKEN` is the
production value from the Vercel project, exported in the operator's own
shell; never paste it into a ticket or a PR.

```sh
curl -sS -X POST 'https://pubmaxxing.com/api/pint-drops' \
  -H 'content-type: application/json' \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"action":"keep_hidden","id":"<drop id>","note":"<why, who asked, date>"}'
```

`200 {"ok":true}` means one row changed. `404` means no row has that id.
`403` means the token is wrong. `503` means the store is down: nothing changed.

Equivalent SQL, if the API is not an option. It touches one row and refuses
to touch a row that is not currently visible:

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

### 3. Check it

```sh
# Public read: the id must be absent.
curl -sS 'https://pubmaxxing.com/api/pint-drops?venueId=<canonical venue id>' | grep -c '<drop id>'
# Moderator read: the id must be present, with the note.
curl -sS 'https://pubmaxxing.com/api/pint-drops?status=hidden' -H "x-admin-token: $ADMIN_TOKEN" | grep -c '<drop id>'
```

The first prints `0`, the second `1`. Then open the pub on the map and check
the Pints tab and the Golden Thread.

### Undo

```sh
curl -sS -X POST 'https://pubmaxxing.com/api/pint-drops' \
  -H 'content-type: application/json' \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"action":"restore","id":"<drop id>"}'
```

or in SQL, putting back the note written down in step 1:

```sql
update public.pint_drops
   set status = 'visible', moderated_at = now(), moderator_note = <previous note or null>
 where id = '<drop id>' and status = 'hidden'
returning id, status;
```

## What stays true after a hide

- The row, its photos and its report trail stay in the database. Photos are
  not signed for public readers while the row is hidden.
- A later report on the drop puts it back in the moderator queue and clears
  `moderated_at` and `moderator_note` (migration 0116), but never makes it
  visible again. Only `restore` does.
- A hidden drop does not count toward the contributor's public stats or
  passport, and cannot be confirmed by a later Second Drinker, because every
  one of those reads asks for `status = 'visible'`.

## Log

| Date | Drop | Venue | Reason | Done by |
| --- | --- | --- | --- | --- |
| Pending | `tester`, Hatton Lager, £4.50, logged 1 Sep 2026 | The Sir Christopher Hatton, 4 Leather Ln, EC1N 7RA (`venue-1vle947`) | Owner asked for it to be hidden, not deleted | Operator, not yet run |
