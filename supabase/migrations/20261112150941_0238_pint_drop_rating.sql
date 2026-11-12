alter table public.pint_drops
  add column if not exists rating smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pint_drops'::regclass
      and conname = 'pint_drops_rating_range'
  ) then
    alter table public.pint_drops
      add constraint pint_drops_rating_range check (rating between 1 and 5);
  end if;
end;
$$;

comment on column public.pint_drops.rating is
  'Optional whole stars for this Pint Drop only. Null means unrated. Owned by lib/pintDropRating.ts.';
