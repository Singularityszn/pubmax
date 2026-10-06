// The migration ledger check. A migration file in this repo is only a promise
// until production's ledger (supabase_migrations.schema_migrations) holds it.
// The audit of 6 October 2026 compared the two and found they had drifted:
// versions differ (files were applied under other timestamps) and six files
// were applied under bare names. So the comparison is BY NAME, never by
// version, and a repo file counts as applied when the ledger holds either its
// full name (`0161_plan_selected_drink_evidence`) or its bare slug
// (`plan_selected_drink_evidence`).
//
// READ-ONLY. The remote read goes to the Supabase Management API's read-only
// query endpoint with one fixed SELECT, so this check cannot change production.

import { readdirSync } from "node:fs";
import path from "node:path";

export const PRODUCTION_PROJECT_REF = "iankajxliutqogqkmvdg";
export const LEDGER_QUERY = "select name from supabase_migrations.schema_migrations order by version";

const FILE_PATTERN = /^(\d{14})_(.+)\.sql$/;
const LABEL_PATTERN = /^\d{4}[a-z]?_/;

/** `{ version, name, bare }` for every migration file in a directory. Rollbacks live in a subdirectory and are skipped. */
export function localMigrations(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .flatMap((entry) => {
      const match = FILE_PATTERN.exec(entry.name);
      if (!match) return [];
      const name = match[2];
      return [{ file: entry.name, version: match[1], name, bare: name.replace(LABEL_PATTERN, "") }];
    });
}

/**
 * @param {Array<{ file: string, name: string, bare: string }>} local
 * @param {Iterable<string>} remoteNames  `name` column of the live ledger
 * @returns {{ missing: string[], remoteOnly: string[] }}
 *   missing: repo files production does not hold. remoteOnly: ledger names no
 *   repo file explains (reported, never a failure: they are the audit's
 *   remote-only bodies, a separate piece of work).
 */
export function compareLedger(local, remoteNames) {
  const remote = new Set(remoteNames);
  const missing = local.filter((m) => !remote.has(m.name) && !remote.has(m.bare)).map((m) => m.file);
  const known = new Set(local.flatMap((m) => [m.name, m.bare]));
  const remoteOnly = [...remote].filter((name) => !known.has(name)).sort();
  return { missing, remoteOnly };
}

/** The live ledger's names, or a thrown Error that never contains the token. */
export async function fetchRemoteLedger({ projectRef, token, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: LEDGER_QUERY }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`The Supabase Management API answered ${response.status} for the ledger read.`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("The ledger read did not answer a list of rows.");
  return rows.map((row) => row?.name).filter((name) => typeof name === "string");
}

export function resolveLedgerTarget(env = process.env) {
  const token = env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is not set. The ledger check needs a Supabase personal access token to read production.",
    );
  }
  return { token, projectRef: env.SUPABASE_PROJECT_REF?.trim() || PRODUCTION_PROJECT_REF };
}

/** Run the whole check. Returns the comparison; throws when production lacks a migration. */
export async function checkMigrationLedger({
  directory = path.join(process.cwd(), "supabase", "migrations"),
  env = process.env,
  fetchImpl = fetch,
  say = () => {},
} = {}) {
  const { token, projectRef } = resolveLedgerTarget(env);
  const local = localMigrations(directory);
  const remote = await fetchRemoteLedger({ projectRef, token, fetchImpl });
  const result = compareLedger(local, remote);
  say(`${local.length} repo migrations, ${remote.length} in the live ledger, ${result.remoteOnly.length} remote-only.`);
  if (result.missing.length > 0) {
    throw new Error(
      `Production lacks ${result.missing.length} migration(s) the repo ships. The captain applies them first:\n` +
        result.missing.map((file) => `  ${file}`).join("\n"),
    );
  }
  return result;
}
