-- Removes the Pal tool-turn owner and the conversation-id shape check (0169 rollback).
-- Rows written under 0169 stay, without an owner. Expired rows are not restored.

alter table public.pub_pal_tool_turns
  drop constraint if exists pub_pal_tool_turns_conversation_id_shape;

alter table public.pub_pal_tool_turns
  drop constraint if exists pub_pal_tool_turns_owner_fk;

drop index if exists pub_pal_tool_turns_owner_id_idx;

alter table public.pub_pal_tool_turns
  drop column if exists owner_id;
