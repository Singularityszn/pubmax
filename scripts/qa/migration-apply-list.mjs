#!/usr/bin/env node
// Prints the owner apply list for supabase/migrations, in real apply order.
//
// The list used to be a hand-typed section in docs/handoffs/FABLE_HANDOFF.md.
// A hand-typed list drifts: it stops being updated, and the migrations directory keeps
// growing past it. This script reads the migrations directory itself, so the
// list can never go stale.
//
// Apply order is TIMESTAMP order, not the four-digit number in a filename.
// Most filenames carry both (20260806160000_0076_plan_member_group_prefs.sql),
// but the number is not reliable: 0075 has a later timestamp than 0076 and
// 0077, because it was renamed after they landed. Some filenames carry no
// number at all. The timestamp prefix is the one thing every file has, and
// it is what `supabase migration list` and the CLI apply order both use.
//
// Usage:
//   node scripts/qa/migration-apply-list.mjs
//     Print every migration filename, oldest first.
//
//   node scripts/qa/migration-apply-list.mjs --against <file>
//     Print only the migrations not yet applied, oldest first.
//     A migration counts as applied when its 14-digit version is in the
//     file, when its four-digit label is, or when the name after that label
//     is. The version is what `supabase migration list` prints. The label is
//     what the captain applies by. The name still matches when production
//     stored the same migration under a different timestamp and dropped the
//     label from the ledger name. A raw pasted CLI table works: blank lines
//     and lines with none of the three are skipped.
//
// Pure filesystem plus argv/stdin. No network call. No secret read.
// supabase/migrations/rollback/ is a subdirectory, so a plain (non-recursive)
// directory read already excludes it.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_RE = /^(\d{14})_.+\.sql$/;
const VERSION_TOKEN_RE = /\b(\d{14})\b/;
const LABEL_IN_FILENAME_RE = /^(?:\d{14}_)?(\d{4})(?:_|$)/;
const LABEL_TOKEN_RE = /(?:^|[^0-9])(\d{4})(?=_[A-Za-z0-9])/g;

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

// Reads one directory and returns its migration filenames in apply order.
export function listMigrations(migrationsDir = MIGRATIONS_DIR) {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && VERSION_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

// Returns the 14-digit version prefix of a migration filename, or null.
export function versionOf(filename) {
  const match = filename.match(VERSION_RE);
  return match ? match[1] : null;
}

// Returns the four-digit label the captain applies by, or null when the
// filename has none. The label sits after the timestamp
// (20261002210000_0170_profiles_table_door.sql) and is not the timestamp.
export function labelOf(filename) {
  const stem = filename.replace(/\.sql$/, "");
  const match = stem.match(LABEL_IN_FILENAME_RE);
  return match ? match[1] : null;
}

// The name after the timestamp and the optional label. Production sometimes
// records only this (`plan_membership_account_claim`) for a file named
// `20260831140000_0127_plan_membership_account_claim.sql`.
export function descriptiveNameOf(filename) {
  const stem = filename.replace(/\.sql$/, "");
  return stem.replace(/^\d{14}_/, "").replace(/^\d{4}_/, "");
}

// Reads applied versions out of free-form text, one 14-digit version per
// line found. Header rows, separator rows, and blank lines have no match
// and are skipped.
export function parseAppliedVersions(text) {
  const applied = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(VERSION_TOKEN_RE);
    if (match) applied.add(match[1]);
  }
  return applied;
}

// Reads four-digit labels out of free-form text. A label is a line that is
// only the four digits, or four digits followed by `_name`, including inside
// `20261003050416_0170_profiles_table_door`. A bare 14-digit version is not a
// label: the digits have to be a token of their own.
export function parseAppliedLabels(text) {
  const labels = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\d{4}$/.test(trimmed)) labels.add(trimmed);
    LABEL_TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = LABEL_TOKEN_RE.exec(line))) labels.add(match[1]);
  }
  return labels;
}

// Reads descriptive names out of free-form text. A ledger row's name may be
// the full `0170_profiles_table_door` or only the tail. Both become the tail.
export function parseAppliedNames(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) {
      names.add(descriptiveNameOf(trimmed));
    }
    const named = trimmed.match(/\d{14}[\s|,;\t]+([A-Za-z0-9_]+)/);
    if (named) names.add(descriptiveNameOf(named[1]));
    const embedded = trimmed.match(/(?:^|[^A-Za-z0-9])(\d{4}_[a-z0-9_]+)/);
    if (embedded) names.add(descriptiveNameOf(embedded[1]));
  }
  return names;
}

// A file is applied when its timestamp version was recorded, its four-digit
// label was, or its descriptive name was. Version differs across production
// and the repo; the label or the name is what the two sides still share.
export function isMigrationApplied(
  filename,
  appliedVersions,
  appliedLabels = new Set(),
  appliedNames = new Set(),
) {
  const version = versionOf(filename);
  if (version && appliedVersions.has(version)) return true;
  const label = labelOf(filename);
  if (label && appliedLabels.has(label)) return true;
  const name = descriptiveNameOf(filename);
  return Boolean(name && appliedNames.has(name));
}

// Filters a migration list down to the ones not yet applied. Keeps the input
// order, so callers pass an already-sorted list.
export function unappliedMigrations(
  migrations,
  appliedVersions,
  appliedLabels = new Set(),
  appliedNames = new Set(),
) {
  return migrations.filter(
    (name) => !isMigrationApplied(name, appliedVersions, appliedLabels, appliedNames),
  );
}

function main() {
  const args = process.argv.slice(2);
  const againstIndex = args.indexOf("--against");
  const migrations = listMigrations();

  let output = migrations;
  if (againstIndex !== -1) {
    const appliedFile = args[againstIndex + 1];
    if (!appliedFile) {
      console.error("--against needs a file path");
      process.exitCode = 1;
      return;
    }
    const appliedText = readFileSync(appliedFile, "utf8");
    output = unappliedMigrations(
      migrations,
      parseAppliedVersions(appliedText),
      parseAppliedLabels(appliedText),
      parseAppliedNames(appliedText),
    );
  }

  for (const name of output) {
    console.log(name);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
