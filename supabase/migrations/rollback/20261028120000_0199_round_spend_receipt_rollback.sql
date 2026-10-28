-- This rollback removes Round receipt links. Stored receipt objects remain.
begin;

alter table public.round_spends
  drop column receipt_photo_key;

commit;
