-- Group message threads (0154). Apply AFTER 0153.
-- Captain applies; agents ship SQL only.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS WRONG. `public.conversations` said 1:1 in SQL and nothing above it
-- could say otherwise: two `not null` handle columns, `unique (handle_a,
-- handle_b)`, a `handle_a < handle_b` order check, and an RLS helper that asked
-- whether the caller owned one of those two columns. The store's own interface
-- repeated it (`participants(): Promise<HandlePair | null>`), so every surface
-- above was written against an assumption of exactly two people.
--
-- WHAT THIS DOES. A conversation gains a KIND, and the kind names its
-- membership authority:
--
--   • `direct` — the PAIR COLUMNS ARE THE AUTHORITY, exactly as they were. The
--     unique pair still makes find-or-create idempotent, the order check still
--     holds, and no existing row moves. There is NO backfill into the members
--     table, deliberately: a second copy of a fact the pair columns already
--     state is what drifted in 0124/0144, and one authority per kind is how
--     that cannot start here.
--
--   • `group` — `public.conversation_members` IS THE AUTHORITY. One row per
--     handle, carrying a role and a nullable `left_at`, because a group nobody
--     can leave is a trap. The pair columns are NULL on a group row.
--
-- WHY THE PAIR COLUMNS BECOME NULLABLE. A group has no pair, and inventing one
-- (the first two members, say) would make the unique index mean two different
-- things and let one pair of people hold two threads. `unique (handle_a,
-- handle_b)` treats NULLs as distinct in PostgreSQL, so any number of group
-- rows sit under it without conflict, and a CHECK that returns NULL passes, so
-- `conversations_pair_order_chk` is untouched. The per-kind shape CHECK below
-- is what says which columns each kind must have.
--
-- RLS. `pubmax_private.rls_is_conversation_participant` gains a GROUP branch,
-- so migration 0148's realtime channel policy admits a group thread's live
-- members with no change to the policy itself, and 0152's two authorities for
-- owning a handle are inherited whole (the helper still delegates every handle
-- question to `rls_owns_handle`). `conversation_members` is RLS-on with a
-- participant SELECT policy and an anon deny, the posture 0066 gave the two
-- messaging tables; every write still goes through the service role.
--
-- Reverse: supabase/migrations/rollback/20260917090000_0154_group_message_threads_rollback.sql

begin;

-- ── conversations: the kind, and what each kind may hold ─────────────────────

alter table public.conversations
  add column if not exists kind              text not null default 'direct',
  add column if not exists title             text,
  add column if not exists created_by_handle text;

comment on column public.conversations.kind is
  'direct | group. The closed set in lib/messageGroupThread.ts. A direct row''s membership is its own pair columns; a group row''s is public.conversation_members.';
comment on column public.conversations.title is
  'A group''s own name, when it was given one. Always null on a direct row: a DM is called by who it is with.';
comment on column public.conversations.created_by_handle is
  'Who opened a group. Null on a direct row, which is opened by whoever spoke first and owned by neither.';

alter table public.conversations alter column handle_a drop not null;
alter table public.conversations alter column handle_b drop not null;

alter table public.conversations drop constraint if exists conversations_kind_chk;
alter table public.conversations
  add constraint conversations_kind_chk
  check (kind in ('direct', 'group'));

-- Each kind owns its own columns and nothing else's. A direct row still carries
-- its pair and no title; a group row carries neither handle.
alter table public.conversations drop constraint if exists conversations_kind_shape_chk;
alter table public.conversations
  add constraint conversations_kind_shape_chk
  check (
    (
      kind = 'direct'
      and handle_a is not null
      and handle_b is not null
      and title is null
    )
    or (
      kind = 'group'
      and handle_a is null
      and handle_b is null
    )
  );

-- Mirrors GROUP_TITLE_MAX in lib/messageGroupThread.ts. Keep the two in lockstep.
alter table public.conversations drop constraint if exists conversations_title_len_chk;
alter table public.conversations
  add constraint conversations_title_len_chk
  check (title is null or char_length(title) between 1 and 60);

-- ── conversation_members: the group's membership ─────────────────────────────
-- ONE row per handle per group. `left_at` rather than a delete, because the
-- words somebody wrote stay in the thread exactly as a departed account's do,
-- and a row that says when they left is what stops a re-join minting a second
-- seat for one person.
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  handle          text not null,
  role            text not null default 'member',
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  primary key (conversation_id, handle)
);

comment on table public.conversation_members is
  'Membership of a GROUP conversation. A direct conversation''s membership is its own pair columns and is deliberately not mirrored here.';
comment on column public.conversation_members.left_at is
  'When they left. A left member reads no new message and their old ones stay; null means live.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversation_members_role_chk'
  ) then
    alter table public.conversation_members
      add constraint conversation_members_role_chk
      check (role in ('owner', 'member'));
  end if;
end $$;

-- The handle alphabet (migration 0029), because the PRIMARY KEY is
-- (conversation_id, handle) and it compares bytes. Without this, 'Ken' and
-- 'ken' are two seats for one person: the key does not stop the second, the
-- inbox lane (`handle = me`) finds only one of them, and the tombstone's
-- `lower(handle) = lower(v_handle)` is written the way it is precisely because
-- nothing else here said the column was already lower case. Now it does, so
-- one person holds one seat and the fold is a formality.
alter table public.conversation_members drop constraint if exists conversation_members_handle_chk;
alter table public.conversation_members
  add constraint conversation_members_handle_chk
  check (handle ~ '^[a-z0-9_]{1,30}$');

-- The inbox read: every group one handle is live in, and the membership of one
-- conversation. Both are hot on every thread open.
create index if not exists conversation_members_handle_idx
  on public.conversation_members (handle)
  where left_at is null;
create index if not exists conversation_members_conversation_idx
  on public.conversation_members (conversation_id)
  where left_at is null;

alter table public.conversation_members enable row level security;

-- ── the participant predicate, widened ───────────────────────────────────────
-- Restated WHOLE because `create or replace function` drops any SET clause it
-- does not carry: the `search_path` line is load-bearing, not decoration. It is
-- redefined in `pubmax_private`, where 0070 moved it and where the policies
-- read it; a copy in `public` is a copy no policy reads (the 0144 hole).
--
-- The direct branch is byte-for-byte what it was, so nothing about a 1:1
-- conversation's authorization moves. The group branch asks the members table
-- for a LIVE row whose handle this caller owns, through the SAME
-- `rls_owns_handle`, so 0152's second authority for owning a handle is
-- inherited rather than restated.
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
    and (
      exists (
        select 1
        from public.conversations c
        where c.id = p_conversation_id
          and (
            c.user_id_a = (select auth.uid())
            or c.user_id_b = (select auth.uid())
            or pubmax_private.rls_owns_handle(c.handle_a)
            or pubmax_private.rls_owns_handle(c.handle_b)
          )
      )
      or exists (
        select 1
        from public.conversation_members m
        where m.conversation_id = p_conversation_id
          and m.left_at is null
          and pubmax_private.rls_owns_handle(m.handle)
      )
    );
$$;

revoke execute on function pubmax_private.rls_is_conversation_participant(uuid)
  from public, anon;
grant execute on function pubmax_private.rls_is_conversation_participant(uuid)
  to authenticated, service_role;

-- ── grants and policies ──────────────────────────────────────────────────────
-- The same posture 0066 gave conversations and messages: SELECT for a signed-in
-- participant, nothing at all for anon, every write through the service role.
grant select on table public.conversation_members to authenticated;
grant select, insert, update, delete on table public.conversation_members to service_role;

drop policy if exists conversation_members_participant_select on public.conversation_members;
create policy conversation_members_participant_select
  on public.conversation_members
  for select
  to authenticated
  using (pubmax_private.rls_is_conversation_participant(conversation_id));

drop policy if exists conversation_members_anon_deny on public.conversation_members;
create policy conversation_members_anon_deny
  on public.conversation_members
  for all
  to anon
  using (false)
  with check (false);

-- A group row is read out of the members table, so the pair-keyed indexes 0019
-- built cannot find one. This is the inbox's group half.
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
    or exists (
      select 1
      from public.conversation_members m
      where m.conversation_id = public.conversations.id
        and m.left_at is null
        and pubmax_private.rls_owns_handle(m.handle)
    )
  );

commit;
