-- Owner and retention for Pal tool-turn rows (0169).
-- 0160 stored provider conversation ids with no account and left expired rows in place.
-- The captain applies this. The app deletes a row once expires_at has passed
-- (two minutes after the user's last line; a tool result never extends it) and
-- refuses a write from any other account.
-- Dropping the owner column on rollback leaves the correlation rows, unowned again.

alter table public.pub_pal_tool_turns
  add column if not exists owner_id uuid;

alter table public.pub_pal_tool_turns
  drop constraint if exists pub_pal_tool_turns_owner_fk;

alter table public.pub_pal_tool_turns
  add constraint pub_pal_tool_turns_owner_fk
  foreign key (owner_id) references auth.users (id) on delete cascade;

delete from public.pub_pal_tool_turns
where expires_at < now()
   or conversation_id !~ '^conv_[A-Za-z0-9]{8,64}$';

alter table public.pub_pal_tool_turns
  drop constraint if exists pub_pal_tool_turns_conversation_id_shape;

alter table public.pub_pal_tool_turns
  add constraint pub_pal_tool_turns_conversation_id_shape
  check (conversation_id ~ '^conv_[A-Za-z0-9]{8,64}$');

create index if not exists pub_pal_tool_turns_owner_id_idx
  on public.pub_pal_tool_turns (owner_id);
