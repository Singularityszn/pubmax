begin;

alter table public.round_spends
  add column receipt_photo_key text;

commit;
