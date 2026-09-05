// One-off effective proof for the 0120 and 0121 rollbacks written in this PR.
// Applies every migration after the v1 release baseline, records the state each
// rollback is meant to undo, runs the rollback, and reports what moved.
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { startRlsSession } from "../../../scripts/rls/session-harness.mjs";

const ROOT = process.argv[2];
const MIGRATIONS = join(ROOT, "supabase/migrations");
const ROLLBACKS = join(MIGRATIONS, "rollback");
const BASELINE = "20260806035204_0070_v1_release_security.sql";

const session = await startRlsSession();
const scalar = (q) => {
  const r = session.sql(`select coalesce((${q}), '(none)')`);
  if (!r.ok) throw new Error(r.err);
  return r.out;
};

try {
  const applied = [];
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql") && n > BASELINE)
    .sort()) {
    session.sqlFile(join(MIGRATIONS, name));
    applied.push(name);
  }
  console.log(`applied ${applied.length} migrations after ${BASELINE}`);
  console.log(`last applied: ${applied.at(-1)}`);

  const columns = (table, names) =>
    scalar(`select string_agg(column_name, ', ' order by column_name) from information_schema.columns where table_schema='public' and table_name='${table}' and column_name in (${names.map((n) => `'${n}'`).join(",")})`);
  const constraints = (table) =>
    scalar(`select string_agg(conname, ', ' order by conname) from pg_constraint where conrelid='public.${table}'::regclass and conname like '%${table === "wanteds" ? "promotion" : "refresh_status%' or conname like '%lifecycle%' or conname like '%revocation"}%'`);
  const policies = (table) =>
    scalar(`select string_agg(policyname, ', ' order by policyname) from pg_policies where schemaname='public' and tablename='${table}'`);
  const grants = (table) =>
    scalar(`select string_agg(distinct grantee, ', ') from information_schema.role_table_grants where table_schema='public' and table_name='${table}' and grantee in ('anon','authenticated')`);
  const fn = (name) =>
    scalar(`select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${name}'`);

  const report = (label) => {
    console.log(`\n--- ${label} ---`);
    console.log("0120 columns          :", columns("external_social_accounts", ["refresh_status", "consent_version", "fetched_at", "upstream_revocation_state"]));
    console.log("0120 lifecycle checks :", constraints("external_social_accounts"));
    console.log("0120 policies         :", policies("external_social_accounts"));
    console.log("0120 browser grantees :", grants("external_social_accounts"));
  };

  report("0120 BEFORE rollback (every migration applied)");
  session.sqlFile(join(ROLLBACKS, "20260827100000_0120_social_connection_lifecycle_rollback.sql"));
  report("0120 AFTER rollback");

  console.log("\n--- 0121 BEFORE rollback ---");
  console.log("0121 columns   :", columns("wanteds", ["promoted_at", "promoted_list_type"]));
  console.log("0121 pair check:", constraints("wanteds"));
  console.log("0121 function  :", fn("promote_wanted_to_saved_list"));

  // The 0121 header says 0122's rollback runs first; this proves the order works.
  session.sqlFile(join(ROLLBACKS, "20260827120000_0122_wanted_promotion_already_saved_fix_rollback.sql"));
  session.sqlFile(join(ROLLBACKS, "20260827110000_0121_wanted_public_list_promotion_rollback.sql"));

  console.log("\n--- 0121 AFTER rollback (0122's rollback first) ---");
  console.log("0121 columns   :", columns("wanteds", ["promoted_at", "promoted_list_type"]));
  console.log("0121 pair check:", constraints("wanteds"));
  console.log("0121 function  :", fn("promote_wanted_to_saved_list"));
  console.log("\nsaved_pubs still present:", scalar("select case when to_regclass('public.saved_pubs') is null then 'no' else 'yes' end"));
  console.log("\nPROOF_OK");
} finally {
  await session.stop();
}
