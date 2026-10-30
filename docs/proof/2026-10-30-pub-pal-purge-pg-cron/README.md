# Pub Pal tool-turn purge in the database (migration 0197)

Run on 30 Oct 2026 in a cloud session, on a throwaway PostgreSQL 16 cluster with
`pg_cron` 1.6 loaded (`shared_preload_libraries = 'pg_cron'`).

## Without pg_cron (the proof fixture)

`scripts/rls/session-fixture.sql`, then all 214 migrations in the order
`scripts/qa/migration-apply-list.mjs` prints. Every migration applied. 0197 printed:

```
NOTICE:  pg_cron is not available on this cluster; the Vercel cron keeps purging pub_pal_tool_turns
```

The rollback ran with no error and no `cron` schema existed.

## With pg_cron

0197 applied twice, then the job table:

```
pubmax-purge-pub-pal-tool-turns|* * * * *|delete from public.pub_pal_tool_turns where expires_at < now()
```

One expired row and one live row were inserted. About 65 seconds later:

```
before:  conv_expiredAAAA, conv_liveBBBBBBB
after:   conv_liveBBBBBBB
cron.job_run_details: succeeded
```

The rollback left 0 jobs.

## What the captain checks after applying it

```sql
select status, start_time from cron.job_run_details
where command like '%pub_pal_tool_turns%'
order by start_time desc limit 5;
```

When the rows say `succeeded`, remove the `/api/cron/purge-pub-pal-turns` entry
from `vercel.json` (and its runbook row) in a follow-up change.
