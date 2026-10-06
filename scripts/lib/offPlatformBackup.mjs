// The rules of the off-platform backup, free of network and database I/O so
// they are tested without a database. scripts/backup-offplatform.mjs does the work and docs/DR_RUNBOOK.md
// owns the restore.
//
// WHY IT EXISTS. Production is on the Supabase free plan: no daily backup, no
// point-in-time recovery (audit of 6 October 2026, 0 backups). The repository is
// public, so a dump may never be a workflow artifact or a committed file. The
// copy lives on the captain's Mac, outside every git checkout, written 0600.

import { readdirSync, rmdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const DEFAULT_BUCKET = "pint-drops";
// Each run deletes what is older than this, except the newest dump and the
// bucket files it names, so a restore is always possible. It is a week inside
// the 8 weeks the privacy page promises, so a weekly run that fires late, on a
// Mac that woke late, still removes every copy before 8 weeks have passed.
export const PRUNE_AFTER_WEEKS = 7;
const PRUNE_AFTER_MS = PRUNE_AFTER_WEEKS * 7 * 24 * 60 * 60 * 1000;
// Public data, the account table and what the auth schema needs to restore
// sign-in, storage object rows, and the migration ledger.
export const DUMP_SCHEMAS = ["public", "auth", "storage", "supabase_migrations"];

/** Connection settings as PG* variables, so the password never rides in an argument list. */
export function pgEnvFromUrl(connectionString) {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("PUBMAX_BACKUP_DB_URL must be a postgres:// connection string.");
  }
  if (!url.hostname || !url.username) {
    throw new Error("PUBMAX_BACKUP_DB_URL needs a host and a user.");
  }
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
    PGSSLMODE: "require",
  };
}

export function dumpFileName(date) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `pubmax-${stamp}.dump`;
}

export function pgDumpArgs(outputFile) {
  return [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    ...DUMP_SCHEMAS.flatMap((schema) => ["--schema", schema]),
    "--file",
    outputFile,
  ];
}

const DUMP_NAME = /^pubmax-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump$/;
const PARTIAL_DUMP_NAME = /^(pubmax-\d{8}T\d{6}Z\.dump)\.partial$/;

/** When a dump was taken, read from its name, or null for any other file. */
function dumpTakenAt(file) {
  const match = DUMP_NAME.exec(file);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * Delete what is past retention, by age, however many runs there were.
 *
 * Dumps: every dump older than `PRUNE_AFTER_WEEKS` goes, except the newest. A
 * partial dump older than the newest dump is a run that was killed, and it goes
 * too. Other files in `dir` are never touched.
 *
 * Bucket files: each run stamps a file's mtime with the run's start while its
 * object is still in the bucket, so the mtime is the last run that saw it. A
 * file last seen before the oldest kept dump belongs to no dump that remains,
 * and it goes with them. With no dump at all, no bucket file is touched.
 *
 * Directories: an emptied directory under `bucketRoot` goes too, because the
 * bucket's folder names are account, profile and conversation ids.
 */
export function pruneBackupCopy({ dir, bucketRoot, now }) {
  const dumps = readdirSync(dir)
    .filter((file) => dumpTakenAt(file) !== null)
    .sort();
  const newest = dumps.at(-1);
  const expired = dumps.filter((file) => file !== newest && dumpTakenAt(file) < now - PRUNE_AFTER_MS);
  const newestTakenAt = newest === undefined ? null : dumpTakenAt(newest);
  const killed =
    newestTakenAt === null
      ? []
      : readdirSync(dir).filter((file) => {
          const match = PARTIAL_DUMP_NAME.exec(file);
          return match !== null && dumpTakenAt(match[1]) < newestTakenAt;
        });
  for (const file of [...expired, ...killed]) rmSync(path.join(dir, file), { force: true });

  const kept = dumps.filter((file) => !expired.includes(file)).map(dumpTakenAt);
  if (kept.length === 0) return { dumps: expired.length + killed.length, files: 0, directories: 0 };
  const oldestKept = Math.min(...kept);

  const entries = readdirSync(bucketRoot, { recursive: true }).map((relative) => {
    const entry = path.join(bucketRoot, relative);
    return { entry, stat: statSync(entry) };
  });
  const files = entries.filter(({ stat }) => stat.isFile() && stat.mtimeMs < oldestKept);
  for (const { entry } of files) rmSync(entry, { force: true });

  let directories = 0;
  const deepestFirst = entries
    .filter(({ stat }) => stat.isDirectory())
    .map(({ entry }) => entry)
    .sort((a, b) => b.length - a.length);
  for (const entry of deepestFirst) {
    if (readdirSync(entry).length > 0) continue;
    rmdirSync(entry);
    directories += 1;
  }
  return { dumps: expired.length + killed.length, files: files.length, directories };
}

/** True when `candidate` is `directory` itself or anything under it. */
export function isInsideDirectory(candidate, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Every object path in a bucket, listing folders recursively through the
 * Storage API. A folder entry has a null id.
 */
export async function listBucketObjects({ baseUrl, key, bucket, fetchImpl = fetch }) {
  const found = [];
  const pending = [""];
  while (pending.length > 0) {
    const prefix = pending.pop();
    for (let offset = 0; ; offset += 100) {
      const response = await fetchImpl(`${baseUrl}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Listing bucket ${bucket} answered ${response.status}.`);
      const page = await response.json();
      for (const entry of page) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null || entry.id === undefined) pending.push(full);
        else {
          found.push({
            path: full,
            size: entry.metadata?.size ?? null,
            // The object's identity. A replacement under the same key keeps its
            // size more often than not, so size alone cannot say "unchanged".
            version: entry.metadata?.eTag ?? entry.updated_at ?? null,
          });
        }
      }
      if (page.length < 100) break;
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Whether an object must be downloaded again. A file is trusted only when it
 * exists, has the listed size, and the version the last run recorded for it is
 * the version listed now. A version nobody can name is never trusted, because
 * the shared upload path replaces objects in place (`upsert: true`).
 */
export function objectNeedsDownload({ exists, localSize, size, version, recordedVersion }) {
  if (!exists) return true;
  if (size !== null && localSize !== size) return true;
  if (version === null || version === undefined) return true;
  return recordedVersion !== version;
}

/** A bucket path that would escape its directory is refused rather than written. */
export function safeObjectPath(root, objectPath) {
  const target = path.resolve(root, objectPath);
  if (!isInsideDirectory(target, root) || target === path.resolve(root)) {
    throw new Error("A bucket object path escaped the backup directory.");
  }
  return target;
}
