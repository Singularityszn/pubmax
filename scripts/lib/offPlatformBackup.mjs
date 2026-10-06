// The rules of the off-platform backup, free of I/O so they are tested without
// a database. scripts/backup-offplatform.mjs does the work and docs/DR_RUNBOOK.md
// owns the restore.
//
// WHY IT EXISTS. Production is on the Supabase free plan: no daily backup, no
// point-in-time recovery (audit of 6 October 2026, 0 backups). The repository is
// public, so a dump may never be a workflow artifact or a committed file. The
// copy lives on the captain's Mac, outside every git checkout, written 0600.

import path from "node:path";

export const DEFAULT_BUCKET = "pint-drops";
export const DEFAULT_KEEP = 8;
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

/** When a dump was taken, read from its name, or null for any other file. */
export function dumpTakenAt(file) {
  const match = DUMP_NAME.exec(file);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** Dump files to delete so only the newest `keep` remain. Other files are never touched. */
export function dumpsToPrune(files, keep = DEFAULT_KEEP) {
  const dumps = files.filter((file) => dumpTakenAt(file) !== null).sort();
  return dumps.slice(0, Math.max(0, dumps.length - keep));
}

/**
 * Bucket files to delete, so the bucket copy keeps nothing longer than the
 * dumps do. Each run stamps a file's mtime with the run's start while its object
 * is still in the bucket, so `lastSeenMs` is the last run that saw it. A file
 * last seen before the oldest kept dump belongs to no dump that remains, and it
 * goes with them. With no dump kept, nothing is pruned.
 */
export function bucketFilesToPrune(localFiles, directoryFiles) {
  const taken = directoryFiles.map(dumpTakenAt).filter((time) => time !== null);
  if (taken.length === 0) return [];
  const oldestKept = Math.min(...taken);
  return localFiles.filter((file) => file.lastSeenMs < oldestKept).map((file) => file.path);
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
        else found.push({ path: full, size: entry.metadata?.size ?? null });
      }
      if (page.length < 100) break;
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/** A bucket path that would escape its directory is refused rather than written. */
export function safeObjectPath(root, objectPath) {
  const target = path.resolve(root, objectPath);
  if (!isInsideDirectory(target, root) || target === path.resolve(root)) {
    throw new Error("A bucket object path escaped the backup directory.");
  }
  return target;
}
