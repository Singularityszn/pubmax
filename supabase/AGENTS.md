# Migrations and row-level security

SQL: migration labels, rollbacks, RLS policies and the permission matrix. Repo-wide rules are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **Every migration lands with its rollback** in `supabase/migrations/rollback/`. `__tests__/migrationVersions.test.ts` refuses a migration without one.
- **Apply one named migration, only on the captain's word.** Apply only when the captain says "apply <n>", and apply only `<n>`. Never apply another pending migration. Its rollback file must already exist. The one path is the Supabase MCP `apply_migration` on project `iankajxliutqogqkmvdg` with the file's SQL. The name is the file name without the timestamp, for example `0221_round_spend_closed_guard`. Read the ledger with `list_migrations` before and after.
- **A separate agent verifies the apply.** The verifier is not the applier. It works read-only: `list_migrations` and `select` statements only. It checks that the ledger lists the name and the expected objects exist, then reports.
- **The four-digit label names one file.** An apply instruction names the label. Take the next free label from `ls supabase/migrations`. Rename the later file when two PRs pick the same one.
- **RLS is the second line of defence.** App stores write through the service role, which bypasses RLS. Policies still deny browser roles on private and secret tables. Never re-open `using (true)` on a private table.
- **RLS helpers live in `pubmax_private`.** A `create or replace function public.rls_*` writes a copy that no policy reads. `__tests__/rlsHelperSchema.test.ts` refuses it.
- **An owner policy filters a statement. It does not fail it.** A stranger's write succeeds against zero rows. A test must assert that nothing moved, not that the statement failed.
- **Every messaging and live channel is private on both sides.** A public Supabase channel authorises on the anon key, which every browser has. The policy on `realtime.messages` is the gate.
- **A rollback says what it costs.** Some rollbacks disclose data, for example dropping a privacy column. The rollback header says so.
- **A deploy can run ahead of the apply.** A new column is additive. Nullability and defaults follow the column-specific rules in `docs/rules/supabase-migrations-and-rls.md`. The store guard decides per column: lose a photo, or refuse the write. A privacy choice or a price-evidence word is refused, never dropped.
- **Prove a migration on real PostgreSQL.** Write a `__tests__/*MigrationEffective.test.ts`: the fault before, the fix after, then the rollback. `npm run test:rls` runs the permission matrix and the RLS proofs. A skipped proof is a failure.
- **The permission matrix is one matrix.** `docs/security/PERMISSION_MATRIX.md` is the expected table. `__tests__/permissionMatrixEffective.test.ts` checks each cell at the route and at the table. Widen it. Do not start a second one.
- **A status column has a value CHECK, and a multi-writer lifecycle moves only through a guarded RPC** that checks the from-state and the expected revision. See [state machines](../docs/rules/state-machines.md).
- **A denied cell never leaks.** It returns the honest status, no data in the whole body and no side effect. An id that names nothing answers exactly like an id somebody else owns.

## Detail

Read the detail only for the rule you change: [`docs/rules/supabase-migrations-and-rls.md`](../docs/rules/supabase-migrations-and-rls.md). It holds each migration's rules, pins and history.
