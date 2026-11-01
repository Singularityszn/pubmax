-- Table requests (0219): "Ask the pub for a table" on the venue sheet (launch
-- plan 1 Nov 2026, section 7 item 3).
-- Captain applies. Agents ship SQL and a rollback beside it.
-- Reverse: rollback/20261102090000_0219_table_requests_rollback.sql
--
-- WHAT A ROW IS. One request from a crew of 6 to 20 that PUBMAXX emailed to a
-- pub's verified operator, kept so the operator panel can list it. It is a
-- MESSAGE, never a booking: no table is held, nothing is confirmed here, and
-- nothing is ever charged. A fee per seated group is a later decision under
-- ADR 0011 and this table has no column for it. Nothing reads this table to
-- change a rank, a pin colour, a price band or an order.
--
-- ONLY A SENT REQUEST STAYS. The route stores a row `pending` before the email
-- goes and stamps it `emailed` once it was sent. A request whose email was not
-- sent is deleted, so an operator never lists a request the person was told
-- PUBMAXX did not send. The CHECK keeps the stamp and the state together.
--
-- THE VENUE IS AN ID, NOT A FOREIGN KEY. Venues live in the committed packs.
-- The route resolves the id to a curated pub before it stores one.
--
-- WHAT IT HOLDS ABOUT A PERSON. The name the table is under and the ONE
-- contact the person chose for the pub to reply to (an email or a phone). The
-- operator panel shows those two, because replying is the point, and never the
-- account id.
--
-- LEAVES WITH THE ACCOUNT. Keyed to the auth user with ON DELETE CASCADE, the
-- 0203 shape, so deleting the account deletes every request it sent and the
-- tombstone trigger needs no edit.
--
-- SERVICE ROLE ONLY. RLS is on, no browser role has a grant, and no policy
-- names anon or authenticated. Writes and the operator read both go through
-- /api/table-requests on the service role, which bypasses RLS, so the
-- advisor's `rls_enabled_no_policy` is answered at the route door
-- (supabase/AGENTS.md, Astra F07).

begin;

create table if not exists public.table_requests (
  id                 uuid primary key default gen_random_uuid(),
  requester_user_id  uuid not null references auth.users (id) on delete cascade,
  venue_id           text not null,
  requester_name     text not null,
  party_size         integer not null,
  requested_date     date not null,
  requested_time     time not null,
  note               text,
  contact_kind       text not null,
  contact_value      text not null,
  delivery           text not null default 'pending',
  created_at         timestamptz not null default now(),
  delivered_at       timestamptz,
  constraint table_requests_venue_id_check
    check (length(venue_id) between 1 and 120),
  constraint table_requests_name_check
    check (length(requester_name) between 1 and 60),
  constraint table_requests_party_size_check
    check (party_size between 6 and 20),
  constraint table_requests_note_len_check
    check (note is null or length(note) <= 300),
  constraint table_requests_contact_kind_check
    check (contact_kind in ('email', 'phone')),
  constraint table_requests_contact_value_check
    check (length(contact_value) between 3 and 254),
  constraint table_requests_delivery_check
    check (delivery in ('pending', 'emailed')),
  constraint table_requests_delivery_stamp_check
    check ((delivery = 'emailed') = (delivered_at is not null))
);

-- The operator panel read: one pub's emailed requests, newest first.
create index if not exists table_requests_venue_created_idx
  on public.table_requests (venue_id, created_at desc)
  where delivery = 'emailed';

-- The requester's own rows and the account-deletion cascade.
create index if not exists table_requests_requester_created_idx
  on public.table_requests (requester_user_id, created_at desc);

alter table public.table_requests enable row level security;

revoke all on table public.table_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.table_requests to service_role;

commit;
