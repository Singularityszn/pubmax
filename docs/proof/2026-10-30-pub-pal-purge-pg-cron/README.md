# Pub Pal tool-turn purge in the database (migration 0202)

Run on 30 Oct 2026 in a cloud session, on a throwaway PostgreSQL 16 cluster with
`pg_cron` 1.6 loaded (`shared_preload_libraries = 'pg_cron'`). The run used
the file's earlier label; it was renamed to 0202 later, because open branches
hold 0197 to 0201. The SQL is the same, so the outputs below still hold.

## Without pg_cron (the proof fixture)

`scripts/rls/session-fixture.sql`, then all 214 migrations in the order
`scripts/qa/migration-apply-list.mjs` prints. Every migration applied. 0202 printed:

```
NOTICE:  pg_cron is not available on this cluster; the Vercel cron keeps purging pub_pal_tool_turns
```

The rollback ran with no error and no `cron` schema existed.

## With pg_cron

0202 applied twice, then the job table:

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

## Production (applied 30 Oct 2026, 18:24 UTC)

The captain asked for the migration to be applied to the production project
(`iankajxliutqogqkmvdg`, PostgreSQL 17) through the Supabase connector. Before:
migrations matched main up to 0196, `pg_cron` 1.6.4 was available and not
installed, and `pub_pal_tool_turns` held no expired rows. After:

```
jobid | jobname                         | schedule  | username | active
1     | pubmax-purge-pub-pal-tool-turns | * * * * * | postgres | t

cron.job_run_details: succeeded 18:25:00 DELETE 0
```

The security advisors showed no new finding. The Vercel route stays in
`vercel.json` as the backstop until the job has a longer run history.

The preload guard (`cron.database_name`) was added after this apply, when the
types check failed on a local cluster that had the pg_cron package installed
but not preloaded. Production defines `cron.database_name` (`postgres`), so
the guarded file does exactly what was applied there.
