#!/usr/bin/env node
// Reports which repo migration labels are missing from an applied list, and
// which applied labels sit after a missing one. The comparison is by the
// four-digit label, not the 14-digit version: production can record the same
// migration under a different timestamp than the file in this repo.
//
// Usage:
//   node scripts/qa/schema-level-report.mjs --against <file>
//     <file> is a paste: `supabase migration list` output, or rows of
//     `version` and `name` from supabase_migrations.schema_migrations.
//     A name like 0170_profiles_table_door counts as label 0170. A name that
//     dropped the label, plan_membership_account_claim, still counts as the
//     repo file that ends in that name. The version need not match. A
//     `supabase migration list` row counts only when its Remote column is
//     filled.
//
//   node scripts/qa/schema-level-report.mjs --fetch
//     Reads that same ledger with one read-only select. The connection
//     string is SCHEMA_LEVEL_DATABASE_URL, a postgres:// URL. The session is
//     default_transaction_read_only. No database data is written. Credentials
//     use a temporary libpq service file with mode 0600, removed after psql exits.
//     The report opens with the target host, without credentials.
//
// Prints two lists, missing first, then out-of-order. A label is missing
// when one of the migrations it carries is unapplied, by the rules in
// migration-apply-list.mjs. Two files with the same label and name are one
// migration, re-timestamped. A label is out of order when it is applied and
// an unapplied migration precedes it. The gap is that unapplied file, not
// the first file that shares its label. Exit 0 after a report. Exit 1 when
// the invocation itself is wrong.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  descriptiveNameOf,
  labelOf,
  listMigrations,
  parseAppliedLabels,
  parseAppliedNames,
  parseAppliedVersions,
  unappliedMigrations,
} from "./migration-apply-list.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

export const APPLIED_LIST_SQL =
  "select version, coalesce(name, '') as name from supabase_migrations.schema_migrations order by version";

// Compares repo filenames, oldest timestamp first, with a pasted or fetched
// applied list. A label is reported once. Its gap opens at the unapplied
// migration, so a later file that reuses an earlier label does not pull
// the labels between those two files into the out-of-order list.
export function compareSchemaLevel(migrations, appliedText) {
  const unapplied = new Set(
    unappliedMigrations(
      migrations,
      parseAppliedVersions(appliedText),
      parseAppliedLabels(appliedText),
      parseAppliedNames(appliedText),
    ),
  );
  const files = [];
  const nameApplied = new Map();

  for (const filename of migrations) {
    const label = labelOf(filename);
    if (!label) continue;
    const name = descriptiveNameOf(filename);
    const key = `${label}\0${name}`;
    nameApplied.set(key, nameApplied.get(key) === true || !unapplied.has(filename));
    files.push({ label, key });
  }

  const labelApplied = new Map();
  for (const { label, key } of files) {
    const applied = nameApplied.get(key) === true;
    labelApplied.set(label, labelApplied.has(label) ? labelApplied.get(label) && applied : applied);
  }

  const missing = [];
  const outOfOrder = [];
  const seenMissing = new Set();
  const seenOutOfOrder = new Set();
  const startedBeforeGap = new Set();
  let gap = false;

  for (const { label, key } of files) {
    if (nameApplied.get(key) !== true) {
      gap = true;
      if (!seenMissing.has(label)) {
        seenMissing.add(label);
        missing.push(label);
      }
      continue;
    }
    if (!gap) {
      startedBeforeGap.add(label);
      continue;
    }
    if (
      labelApplied.get(label) &&
      !startedBeforeGap.has(label) &&
      !seenMissing.has(label) &&
      !seenOutOfOrder.has(label)
    ) {
      seenOutOfOrder.add(label);
      outOfOrder.push(label);
    }
  }

  return { missing, outOfOrder };
}

// `target` is the database host the applied list came from, when known.
export function formatSchemaLevelReport({ target, missing, outOfOrder }) {
  const header = target ? [`target: ${target}`] : [];
  return [...header, "missing:", ...missing, "out-of-order:", ...outOfOrder, ""].join("\n");
}

// The host and port of a postgres:// URL. The user, password, database and
// query never leave this function.
function targetHostOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || !/^postgres(?:ql)?:$/.test(parsed.protocol) || !parsed.host) {
    throw new Error("SCHEMA_LEVEL_DATABASE_URL must be a postgres:// URL with a host");
  }
  return parsed.host;
}

// Runs the fixed select using a private libpq service file.
export function fetchAppliedList(env, execFile = execFileSync) {
  const url = env.SCHEMA_LEVEL_DATABASE_URL?.trim();
  if (!url) throw new Error("--fetch needs SCHEMA_LEVEL_DATABASE_URL");
  const target = targetHostOf(url);
  const parsed = new URL(url);
  const fields = new Map();
  fields.set("host", parsed.hostname);
  if (parsed.port) fields.set("port", parsed.port);
  if (parsed.username) fields.set("user", decodeURIComponent(parsed.username));
  if (parsed.password) fields.set("password", decodeURIComponent(parsed.password));
  if (parsed.pathname.length > 1) fields.set("dbname", decodeURIComponent(parsed.pathname.slice(1)));
  for (const [key, value] of parsed.searchParams) fields.set(key, value);
  const options = `${fields.get("options") || env.PGOPTIONS || ""} -c default_transaction_read_only=on`.trim();
  fields.set("options", options);
  for (const [key, value] of fields) {
    if (!/^[a-z_]+$/.test(key) || /[\r\n]/.test(value) || value !== value.trim()) {
      throw new Error("SCHEMA_LEVEL_DATABASE_URL has an unsupported service parameter");
    }
  }
  const dir = mkdtempSync(path.join(tmpdir(), "pubmax-schema-service-"));
  const serviceFile = path.join(dir, "service.conf");
  try {
    writeFileSync(serviceFile, `[schema_report]\n${[...fields].map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { mode: 0o600 });
    const text = execFile(
      "psql",
      ["--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "\t", "-c", APPLIED_LIST_SQL],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...env, SCHEMA_LEVEL_DATABASE_URL: "", PGSERVICEFILE: serviceFile, PGSERVICE: "schema_report", PGOPTIONS: options },
      },
    );
    return { target, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const secrets = [parsed.password ? decodeURIComponent(parsed.password) : "", fields.get("password"), fields.get("sslpassword")]
      .filter(Boolean).sort((a, b) => b.length - a.length);
    let redacted = message.split(url).join("<SCHEMA_LEVEL_DATABASE_URL>");
    for (const secret of secrets) redacted = redacted.split(secret).join("<REDACTED>");
    throw new Error(redacted);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const againstIndex = args.indexOf("--against");
  const fetch = args.includes("--fetch");
  if ((againstIndex !== -1 && fetch) || (againstIndex === -1 && !fetch)) {
    console.error(
      "Usage: node scripts/qa/schema-level-report.mjs --against <file> | --fetch",
    );
    process.exitCode = 1;
    return;
  }

  let appliedText;
  let target;
  if (fetch) {
    try {
      ({ target, text: appliedText } = fetchAppliedList(process.env));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
  } else {
    const appliedFile = args[againstIndex + 1];
    if (!appliedFile) {
      console.error("--against needs a file path");
      process.exitCode = 1;
      return;
    }
    appliedText = readFileSync(appliedFile, "utf8");
  }

  const report = compareSchemaLevel(listMigrations(MIGRATIONS_DIR), appliedText);
  process.stdout.write(formatSchemaLevelReport({ target, ...report }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
