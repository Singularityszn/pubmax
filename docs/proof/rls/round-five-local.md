# RLS round five local proof

Date: 4 August 2026

Scope: disposable local database only. No command in this run connected to or migrated the live Supabase project.

## Runtime

```text
$ postgres --version
postgres (PostgreSQL) 16.14 (Homebrew)
$ postgrest --version
PostgREST 14.16
$ node --version
v24.19.0
$ npm --version
11.17.0
```

## What ran

`scripts/rls/session-harness.mjs` starts a throwaway PostgreSQL 16 cluster, bootstraps only Supabase-owned roles and schemas, applies all 80 repository migrations before wave 2, snapshots the pre-wave policy and privilege catalog, and applies these five forward files directly:

```text
20260803200000_0065_rls_wave2_helpers.sql
20260803201000_0066_rls_wave2_priority_policies.sql
20260803202000_0067_rls_wave2_owner_policies.sql
20260803203000_0068_rls_wave2_service_role_only.sql
20260803204000_0069_rls_wave2_rpc_hardening.sql
```

The runner then starts PostgREST 14.16 against that database and runs 36 effective-session cases. This is the 34-case gate-four suite plus exact-migration and private-Storage boundary cases.

## Actual session-test output

Command: `NO_COLOR=1 npm run test:rls`

```text
> pubmaxxing@0.1.0 test:rls
> node scripts/rls/run-session-tests.mjs


 RUN  v4.1.10 /Users/karanmanoharan/.treehouse/pubmax-4f650b/7/pubmax

 ✓ __tests__/rlsWave2Session.test.ts > migration execution > applies every exact wave-2 migration file 2ms
 ✓ __tests__/rlsWave2Session.test.ts > private Pint Drop storage > denies direct client reads and permits service-role reads 114ms
 ✓ __tests__/rlsWave2Session.test.ts > visit_reports — effective RLS > denies anonymous on every drop 30ms
 ✓ __tests__/rlsWave2Session.test.ts > visit_reports — effective RLS > allows any authenticated reader on a visible public drop 30ms
 ✓ __tests__/rlsWave2Session.test.ts > visit_reports — effective RLS > denies a non-follower on a friends-only drop 64ms
 ✓ __tests__/rlsWave2Session.test.ts > visit_reports — effective RLS > allows the author and a follower on a friends-only drop 62ms
 ✓ __tests__/rlsWave2Session.test.ts > visit_reports — effective RLS > allows only the author on a legacy drop 63ms
 ✓ __tests__/rlsWave2Session.test.ts > visit_reports — effective RLS > denies hidden and pending to the author (and everyone else) 262ms
 ✓ __tests__/rlsWave2Session.test.ts > visit_reports — effective RLS > keeps a hidden drop undeletable by its author (moderation record survives) 120ms
 ✓ __tests__/rlsWave2Session.test.ts > community_prices — effective RLS > denies anonymous 68ms
 ✓ __tests__/rlsWave2Session.test.ts > community_prices — effective RLS > allows authenticated select of non-hidden rows 88ms
 ✓ __tests__/rlsWave2Session.test.ts > community_prices — effective RLS > denies hidden rows even to the contributing actor 133ms
 ✓ __tests__/rlsWave2Session.test.ts > community_prices — effective RLS > keeps a hidden price undeletable by its contributing actor 117ms
 ✓ __tests__/rlsWave2Session.test.ts > private_account_identities — effective RLS > denies anonymous select 54ms
 ✓ __tests__/rlsWave2Session.test.ts > private_account_identities — effective RLS > allows owner select and denies other user 99ms
 ✓ __tests__/rlsWave2Session.test.ts > private_account_identities — effective RLS > denies authenticated insert/update/delete (service-role only writes) 155ms
 ✓ __tests__/rlsWave2Session.test.ts > plans — effective RLS > denies anonymous 51ms
 ✓ __tests__/rlsWave2Session.test.ts > plans — effective RLS > allows owner and denies other user 108ms
 ✓ __tests__/rlsWave2Session.test.ts > messages — effective RLS > denies anonymous 49ms
 ✓ __tests__/rlsWave2Session.test.ts > messages — effective RLS > allows a conversation participant and denies a stranger 138ms
 ✓ __tests__/rlsWave2Session.test.ts > saved_pubs — effective RLS > denies anonymous 46ms
 ✓ __tests__/rlsWave2Session.test.ts > saved_pubs — effective RLS > allows owner and denies other user 93ms
 ✓ __tests__/rlsWave2Session.test.ts > structured_visit_reports + rounds — effective RLS > hides hidden structured visit reports from their author 100ms
 ✓ __tests__/rlsWave2Session.test.ts > structured_visit_reports + rounds — effective RLS > keeps a hidden structured visit report undeletable by its author 102ms
 ✓ __tests__/rlsWave2Session.test.ts > structured_visit_reports + rounds — effective RLS > denies client roles on rounds (service-role only) 97ms
 ✓ __tests__/rlsWave2Session.test.ts > night_story_moments / night_stories / night_moments — write isolation > lets any authenticated reader select moments on a published public story 52ms
 ✓ __tests__/rlsWave2Session.test.ts > night_story_moments / night_stories / night_moments — write isolation > lets a moment author read but not delete its published story join through PostgREST 80ms
 ✓ __tests__/rlsWave2Session.test.ts > night_story_moments / night_stories / night_moments — write isolation > denies non-host DELETE on a published story moment (moderation record / join survives) 226ms
 ✓ __tests__/rlsWave2Session.test.ts > night_story_moments / night_stories / night_moments — write isolation > denies non-host DELETE on a draft night story and a private night moment 243ms
 ✓ __tests__/rlsWave2Session.test.ts > night_story_moments / night_stories / night_moments — write isolation > denies non-owner SELECT of a private night moment and draft story 96ms
 ✓ __tests__/rlsWave2Session.test.ts > hidden rows through PostgREST > 'night_moments' cannot be observed or deleted by its protected actor 53ms
 ✓ __tests__/rlsWave2Session.test.ts > hidden rows through PostgREST > 'night_stories' cannot be observed or deleted by its protected actor 51ms
 ✓ __tests__/rlsWave2Session.test.ts > hidden rows through PostgREST > 'night_story_moments' cannot be observed or deleted by its protected actor 52ms
 ✓ __tests__/rlsWave2Session.test.ts > hidden rows through PostgREST > 'community_prices' cannot be observed or deleted by its protected actor 47ms
 ✓ __tests__/rlsWave2Session.test.ts > hidden rows through PostgREST > 'visit_reports' cannot be observed or deleted by its protected actor 46ms
 ✓ __tests__/rlsWave2Session.test.ts > rollback path > restores the complete pre-wave policy and privilege catalog 128ms

 Test Files  1 passed (1)
      Tests  36 passed (36)
   Start at  18:56:24
   Duration  8.91s (transform 48ms, setup 26ms, import 27ms, tests 8.73s, environment 0ms)
```

## Rollback proof

The final case applies `supabase/migrations/rollback/20260803200000_rls_wave2_rollback.sql` to the same throwaway database after all five forward migrations. It then serialises and compares the catalog from before and after wave 2. Compared state includes:

- every policy in `public` and `storage`;
- table and explicit column privileges for `PUBLIC`, `anon`, `authenticated`, and `service_role`;
- public routine privileges; and
- every public function definition.

Result: exact string equality. Output line:

```text
✓ __tests__/rlsWave2Session.test.ts > rollback path > restores the complete pre-wave policy and privilege catalog 128ms
```

## Earlier defects rechecked

- Friends-only Pint Drops: strangers and non-followers denied; author and follower allowed.
- Hidden rows: authors cannot read hidden Pint Drops, community prices, or structured Visit Reports.
- Private identities: authenticated direct INSERT, UPDATE, and DELETE denied; owner SELECT remains allowed.
- PostgREST deletion: protected hidden rows in `visit_reports`, `community_prices`, `night_moments`, `night_stories`, and `night_story_moments` remain present after client DELETE attempts.

## Storage decision

No permissive `storage.objects` policy was added. Pint Drop photo reads use the server-side service-role client to create short-lived signed URLs. A direct authenticated or anonymous table read therefore is not part of the product path. Opening an owner policy would require a durable, verified account-to-object-key binding that this schema does not hold.

Tested boundary: seeded private `pint-drops` object is invisible to `anon` and `authenticated`, including its owner JWT, and visible to `service_role`. `__tests__/pintDropsStore.test.ts` separately pins signed-URL generation through the service client.

## Honest policy coverage

Effective policy behavior is tested for 11 public tables:

1. `visit_reports`
2. `community_prices`
3. `private_account_identities`
4. `plans`
5. `messages`
6. `saved_pubs`
7. `structured_visit_reports`
8. `rounds`
9. `night_moments`
10. `night_stories`
11. `night_story_moments`

`storage.objects` is separate. Its tested contract is deny-by-default direct client access plus service-role access, not a permissive user policy. All other wave-2 tables have SQL shape and inventory coverage only, not effective session-policy proof.

## Repository gate

First run reached 7,526 passing tests, then failed the resilient audit on newly published high-severity `brace-expansion` advisories. `npm audit fix` updated lockfile-only transitive versions from 1.1.16 to 1.1.18 and from 5.0.8 to 5.0.9. Final `npm run verify` result is recorded after the fixed rerun below.

```text
DATA VALIDATION PASSED: all 17 datasets valid.

✖ 29 problems (0 errors, 29 warnings)

Test Files  749 passed (749)
     Tests  7526 passed (7526)
  Duration  140.07s

Statements   : 79.7% ( 27280/34226 )
Branches     : 72.46% ( 21121/29147 )
Functions    : 85.05% ( 5401/6350 )
Lines        : 83.55% ( 23854/28549 )

[resilient-audit] no high/critical vulnerabilities.
```

Exit status: 0. Lint warnings are existing repository warnings; this change adds no lint error or warning.
