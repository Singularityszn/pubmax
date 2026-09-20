-- Rollback for 0155 (group message threads).
--
-- WHAT THIS COSTS. Every GROUP conversation and every word in one. The pair
-- columns are `not null` again, so a row with no pair cannot exist, and the
-- membership table that said who was in one is dropped. Direct conversations
-- are untouched: their membership was always their own pair columns, nothing
-- was backfilled, and no message of theirs is read or written here.
--
-- Run it only when group threads are being withdrawn, and only knowing that
-- what the group said goes with them. Export first if any of it matters.
--
-- WHAT IT RESTORES. 0070's participant predicate exactly as 0152 left it (the
-- direct branch alone), 0066's conversations SELECT policy without the group
-- arm, and 0019's two `not null` handle columns.

begin;

-- The words first, then the rows that named them, then the conversations: the
-- messages FK is `on delete cascade`, but deleting explicitly says out loud
-- what this is taking rather than leaving it to a cascade nobody reads.
delete from public.messages m
 using public.conversations c
 where c.id = m.conversation_id
   and c.kind = 'group';

delete from public.conversations where kind = 'group';

-- THE POLICIES COME OFF BEFORE THE TABLE, because the conversations SELECT
-- policy 0155 widened NAMES the members table, and PostgreSQL refuses to drop a
-- table a policy depends on. Restoring the predicate and the policy first is
-- what makes the drop below plain rather than a CASCADE that would take the
-- policy with it and leave the table unguarded in between.
create or replace function pubmax_private.rls_is_conversation_participant(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_conversation_id is not null
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.conversations c
      where c.id = p_conversation_id
        and (
          c.user_id_a = (select auth.uid())
          or c.user_id_b = (select auth.uid())
          or pubmax_private.rls_owns_handle(c.handle_a)
          or pubmax_private.rls_owns_handle(c.handle_b)
        )
    );
$$;

revoke execute on function pubmax_private.rls_is_conversation_participant(uuid)
  from public, anon;
grant execute on function pubmax_private.rls_is_conversation_participant(uuid)
  to authenticated, service_role;

drop policy if exists conversations_participant_select on public.conversations;
create policy conversations_participant_select
  on public.conversations
  for select
  to authenticated
  using (
    user_id_a = (select auth.uid())
    or user_id_b = (select auth.uid())
    or pubmax_private.rls_owns_handle(handle_a)
    or pubmax_private.rls_owns_handle(handle_b)
  );

drop policy if exists conversation_members_participant_select on public.conversation_members;
drop policy if exists conversation_members_anon_deny on public.conversation_members;
drop table if exists public.conversation_members;

alter table public.conversations drop constraint if exists conversations_kind_shape_chk;
alter table public.conversations drop constraint if exists conversations_title_len_chk;
alter table public.conversations drop constraint if exists conversations_kind_chk;

alter table public.conversations alter column handle_a set not null;
alter table public.conversations alter column handle_b set not null;

alter table public.conversations
  drop column if exists created_by_handle,
  drop column if exists title,
  drop column if exists kind;

commit;
