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
//     default_transaction_read_only. Nothing is written. The report opens
//     with the target host, without credentials.
//
// Prints two lists, missing first, then out-of-order. A label is missing
// when one of the migrations it carries is unapplied, by the rules in
// migration-apply-list.mjs. Two files with the same label and name are one
// migration, re-timestamped. A label is out of order when it is applied and
// an unapplied migration precedes it. The gap is that unapplied file, not
// the first file that shares its label. Exit 0 after a report. Exit 1 when
// the invocation itself is wrong.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

// Runs the fixed select and returns the ledger text with the host it came
// from. `execFile` is injectable so a test can see the arguments without a
// database. The connection string is an argument to psql and is replaced by
// <SCHEMA_LEVEL_DATABASE_URL> in any error this function throws.
export function fetchAppliedList(env, execFile = execFileSync) {
  const url = env.SCHEMA_LEVEL_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("--fetch needs SCHEMA_LEVEL_DATABASE_URL");
  }
  const target = targetHostOf(url);
  const previousOptions = env.PGOPTIONS ? `${env.PGOPTIONS} ` : "";
  let text;
  try {
    text = execFile(
      "psql",
      [url, "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "\t", "-c", APPLIED_LIST_SQL],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...env,
          PGOPTIONS: `${previousOptions}-c default_transaction_read_only=on`,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.split(url).join("<SCHEMA_LEVEL_DATABASE_URL>"));
  }
  return { target, text };
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
