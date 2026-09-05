# The 0120 and 0121 rollbacks, proved on PostgreSQL 16

Thermonuclear review item 6. Both migrations shipped with no rollback, so this
records that the twins written for them really do undo what they claim, on a
real cluster rather than by reading the SQL.

## Method

`prove-rollbacks.mjs` in this directory, run once on 2026-09-06 against local
PostgreSQL 16 through the repository's own `scripts/rls/session-harness.mjs`
(the harness `npm run test:rls` uses). It applies every migration after the v1
release baseline `20260806035204_0070_v1_release_security.sql`, 78 files,
ending at `0147`, then reads the catalog before and after each rollback.

```
node docs/proof/migration-rollback-twins/prove-rollbacks.mjs "$(pwd)"
```

Nothing was applied to any deployment. The cluster is a throwaway directory the
harness creates and deletes, and the transcript holds catalog names only.

## What it shows

`transcript.txt` is the unedited run. Both headers' claims hold:

**0120.** Before the rollback the four lifecycle columns are present, the three
lifecycle CHECK constraints are on the table, and the browser roles hold no
grant and no policy, which is the door 0120 closed. After it the columns and
the checks are gone and 0067's state is back: `external_social_accounts_owner_all`
and `external_social_accounts_anon_deny` exist again and `authenticated` holds
table grants. That is the re-opened door the header warns about, in the catalog.

**0121.** Before the rollback `promoted_at`, `promoted_list_type`,
`wanteds_promotion_pair_check` and `promote_wanted_to_saved_list` all exist.
The run applies 0122's rollback first, the order the 0121 header requires, then
0121's, and all four are gone. `saved_pubs` is still present, which is the
asymmetry the header names: a promotion's saved row survives the rollback of
the thing that recorded the promotion.

One piece of noise worth naming rather than editing out: the constraint query
matches on `%lifecycle%`, so two `social_post_media_lifecycle_events_*` rows
from an unrelated table appear in the 0120 lines. They are constant across
before and after and are not part of the claim.
