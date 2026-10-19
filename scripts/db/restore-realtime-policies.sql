-- Run once after restoring an off-platform dump into a Supabase project
-- (docs/DR_RUNBOOK.md, restore step). The backup leaves the platform-owned
-- `realtime` schema out on purpose, because its rows are transient, but two
-- migrations put APPLICATION policies on realtime.messages: 0148 (private
-- messaging topics) and 0171 (the Pint Drop topic). The restored migration
-- ledger marks both as applied, so nothing would put them back, and without
-- them no signed-in browser can join either private channel.
--
-- This file is those two policies, exactly as the migrations leave them. The
-- restore proof in __tests__/offPlatformBackupEffective.test.ts runs it and
-- compares every realtime policy with the migrated source, so a migration that
-- adds or changes one fails that test until this file says the same thing.
-- Safe to run more than once. It needs the restored pubmax_private helpers.

begin;

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise exception 'realtime.messages is absent; run this on the Supabase project the dump was restored into';
  end if;
  if to_regprocedure('pubmax_private.rls_may_read_messaging_topic(text)') is null then
    raise exception 'pubmax_private.rls_may_read_messaging_topic is absent; restore the dump first';
  end if;

  execute 'drop policy if exists pubmax_messaging_topics_read on realtime.messages';
  execute $policy$
    create policy pubmax_messaging_topics_read
      on realtime.messages
      for select
      to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and pubmax_private.rls_may_read_messaging_topic(realtime.topic())
      )
  $policy$;

  execute 'drop policy if exists pubmax_pint_drops_topic_read on realtime.messages';
  execute $policy$
    create policy pubmax_pint_drops_topic_read
      on realtime.messages
      for select
      to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and realtime.topic() = 'live:pint-drops'
      )
  $policy$;
end $$;

commit;
