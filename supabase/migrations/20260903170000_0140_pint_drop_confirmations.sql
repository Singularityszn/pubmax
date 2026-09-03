-- Give a Pint Drop a CONFIRMATION, so green has a producer (#1354).
--
-- lib/pintIndex.ts has always refused a `confirmed_pint_drop` source unless it
-- carries `reviewState: "confirmed"` and a `confirmationId`, and lib/trustPill.ts
-- has always known what green means. Nothing minted one, so the London scout
-- found the standing unreachable: no code path could confirm a Pint Drop.
--
-- The confirmation is DATA, not a derivation. Corroboration is already derived
-- on every read (corroboratedPriceDrop, lib/venues.ts), but a derivation cannot
-- be cited: the Pint Index publishes a figure with a source, and a source has
-- to name the moment a second drinker agreed and the id that moment carries.
-- These columns record exactly that, and nothing about WHO: the pair is named
-- by drop id, never by handle or account.
--
-- Ageing out is a READING, not a write. A confirmation over 30 days old stops
-- painting green (trustToneForConfirmation) and stays on the row, because the
-- night it happened is still true. Nothing here expires a row.

alter table public.pint_drops
  add column if not exists confirmation_id uuid,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmation_basis text,
  add column if not exists confirming_drop_id uuid;

comment on column public.pint_drops.confirmation_id is
  'Minted id the public Pint Index cites for this confirmation. Null until confirmed.';
comment on column public.pint_drops.confirmed_at is
  'When the confirmation was minted. Never cleared for age: the trust window is a read-side reading.';
comment on column public.pint_drops.confirmation_basis is
  'second_reporter (a second independent authority key agreed) or moderator (a person decided).';
comment on column public.pint_drops.confirming_drop_id is
  'The peer Pint Drop that agreed. Set on the second_reporter basis only.';

-- A half-written confirmation is not evidence: an id with no date, or a date
-- with no basis, could not answer the citation it invites. All three arrive
-- together or none of them do.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pint_drops'::regclass
       and conname = 'pint_drops_confirmation_complete'
  ) then
    alter table public.pint_drops
      add constraint pint_drops_confirmation_complete
      check (
        (confirmation_id is null and confirmed_at is null and confirmation_basis is null)
        or (confirmation_id is not null and confirmed_at is not null and confirmation_basis is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pint_drops'::regclass
       and conname = 'pint_drops_confirmation_basis_known'
  ) then
    alter table public.pint_drops
      add constraint pint_drops_confirmation_basis_known
      check (confirmation_basis is null or confirmation_basis in ('second_reporter', 'moderator'));
  end if;

  -- A moderator confirmation is one person's decision and names no second
  -- reporter, so a peer id on that basis would be a claim nobody made.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pint_drops'::regclass
       and conname = 'pint_drops_confirming_drop_only_on_pair'
  ) then
    alter table public.pint_drops
      add constraint pint_drops_confirming_drop_only_on_pair
      check (confirming_drop_id is null or confirmation_basis = 'second_reporter');
  end if;
end
$$;

-- The two reads this adds: one venue's confirmed drops (the trust pill and the
-- Index producer), and the moderator's confirmed lane.
create index if not exists pint_drops_confirmed_venue_idx
  on public.pint_drops (venue_id, confirmed_at desc)
  where confirmation_id is not null;
