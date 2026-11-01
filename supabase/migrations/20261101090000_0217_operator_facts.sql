-- Operator facts (0217): what a moderator's acceptance of a verified pub
-- operator's proposal publishes (launch plan 1 Nov 2026, section 7 item 1).
-- Captain applies. Agents ship SQL and a rollback beside it.
-- Reverse: rollback/20261101090000_0217_operator_facts_rollback.sql
--
-- WHY. 0048 stores a proposal and its review status, and the accept branch of
-- app/api/operator-proposals/route.ts built a fact and handed it back in the
-- response, where nothing kept it and nothing read it. A pub that claimed its
-- page and added a quiz night saw nothing happen. This table is the kept fact,
-- and the venue sheet and Tonight read it.
--
-- WHAT A ROW IS. The pub's own dated word, shown in its own block labelled
-- "From the pub": an event, an offer, a correction or a response. It is never a
-- price, never hours on record, never paid and never a ranking signal. Nothing
-- reads this table to change a pack, a pin colour, a price band or any order
-- (docs/SPONSORSHIP_POLICY.md, the never-changes list).
--
-- ONE ROW PER PROPOSAL. `proposal_id` is unique, so a second accept of the
-- same proposal republishes the one row in place. A later decline stamps
-- `withdrawn_at`, and a withdrawn row is never read by anybody.
--
-- `on_date` is the one London calendar date an event or offer is on, when the
-- operator gave one. It is what lets Tonight show a published event on its
-- night. `when_text` is the operator's own words ("Thursdays, 8pm") and is
-- never parsed into a date. The CHECK keeps a date off a correction or a
-- response.
--
-- THE VENUE IS AN ID, NOT A FOREIGN KEY. Venues live in the committed packs.
-- The proposal IS a foreign key: a fact is only ever published from one, and
-- the unique constraint's index covers it.
--
-- READS. RLS is on. anon and authenticated may SELECT the public columns of a
-- PUBLISHED row (`withdrawn_at is null`) and nothing else: `account_id` (the
-- operator's auth uid), `proposal_id` and `withdrawn_at` hold no browser grant,
-- so a withdrawn row and the operator behind a row never list through the
-- table. The app itself reads through the service role.
--
-- WRITES. Service role only. The one writer is the moderator branch of
-- /api/operator-proposals (supabase/AGENTS.md, Astra F07). No browser role
-- holds INSERT, UPDATE or DELETE.

begin;

create table if not exists public.operator_facts (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references public.operator_proposals (id) on delete cascade,
  venue_id      text not null,
  account_id    text not null,
  kind          text not null,
  title         text,
  body          text,
  field         text,
  when_text     text,
  on_date       date,
  published_at  timestamptz not null default now(),
  withdrawn_at  timestamptz,
  constraint operator_facts_proposal_unique unique (proposal_id),
  constraint operator_facts_venue_id_check
    check (length(venue_id) between 1 and 120),
  constraint operator_facts_account_id_check
    check (length(account_id) between 1 and 128),
  constraint operator_facts_kind_check
    check (kind in ('correction', 'event', 'offer', 'response')),
  constraint operator_facts_title_len_check
    check (title is null or length(title) <= 120),
  constraint operator_facts_body_len_check
    check (body is null or length(body) <= 500),
  constraint operator_facts_field_len_check
    check (field is null or length(field) <= 60),
  constraint operator_facts_when_len_check
    check (when_text is null or length(when_text) <= 60),
  constraint operator_facts_on_date_kind_check
    check (on_date is null or kind in ('event', 'offer'))
);

-- The venue sheet read: one pub's published facts, newest first.
create index if not exists operator_facts_venue_published_idx
  on public.operator_facts (venue_id, published_at desc)
  where withdrawn_at is null;

-- The Tonight read: published events and offers dated for one night.
create index if not exists operator_facts_on_date_published_idx
  on public.operator_facts (on_date, published_at desc)
  where withdrawn_at is null and on_date is not null;

alter table public.operator_facts enable row level security;

revoke all on table public.operator_facts from public, anon, authenticated;
grant select, insert, update, delete on table public.operator_facts to service_role;
grant select (id, venue_id, kind, title, body, field, when_text, on_date, published_at)
  on table public.operator_facts to anon, authenticated;

drop policy if exists operator_facts_published_read on public.operator_facts;
create policy operator_facts_published_read
  on public.operator_facts
  for select
  to anon, authenticated
  using (withdrawn_at is null);

commit;
