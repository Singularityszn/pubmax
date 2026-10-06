#!/usr/bin/env node
// npm run backup:offplatform - a pg_dump plus a sync of the pint-drops bucket,
// written to a private directory on this machine, never into the repository.
// The rules are scripts/lib/offPlatformBackup.mjs and the restore is
// docs/DR_RUNBOOK.md. scripts/install-backup-launchd.mjs schedules it weekly.
//
// Environment (never printed):
//   PUBMAX_BACKUP_DB_URL        postgres:// connection string (session pooler or direct)
//   SUPABASE_URL                project URL, for the bucket sync
//   SUPABASE_SERVICE_ROLE_KEY   secret key, for the bucket sync
//   PUBMAX_BACKUP_DIR           default ~/pubmax-backups
//   PUBMAX_ALERT_WEBHOOK_URL    optional; a failure posts one line here
// `--dry-run` prints the plan and touches nothing.

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_BUCKET,
  dumpFileName,
  listBucketObjects,
  pgDumpArgs,
  pgEnvFromUrl,
  pruneBackupCopy,
  PRUNE_AFTER_WEEKS,
  safeObjectPath,
} from "./lib/offPlatformBackup.mjs";

const dryRun = process.argv.includes("--dry-run");
const env = process.env;

function requireEnv(name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function nearestExistingDirectory(directory) {
  let current = directory;
  while (!existsSync(current)) current = path.dirname(current);
  return current;
}

function gitTopLevel(directory) {
  try {
    return execFileSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

async function runBackup() {
  const dir = path.resolve(env.PUBMAX_BACKUP_DIR?.trim() || path.join(os.homedir(), "pubmax-backups"));
  const bucket = env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_BUCKET;

  // The repository is public: a backup under any git checkout could be committed.
  // A directory not made yet is judged by the nearest one that exists.
  if (gitTopLevel(nearestExistingDirectory(dir))) {
    throw new Error("PUBMAX_BACKUP_DIR is inside a git checkout. Choose a directory outside every repository.");
  }

  const dbUrl = requireEnv("PUBMAX_BACKUP_DB_URL");
  const pgEnv = pgEnvFromUrl(dbUrl);
  const baseUrl = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const startedAt = new Date();
  const dumpFile = path.join(dir, dumpFileName(startedAt));
  const bucketRoot = path.join(dir, "bucket", bucket);

  console.log(`[backup] directory ${dir}`);
  console.log(`[backup] dump ${path.basename(dumpFile)} from ${pgEnv.PGHOST}; bucket ${bucket}; prune after ${PRUNE_AFTER_WEEKS} weeks`);
  if (dryRun) {
    console.log("[backup] dry run: nothing was read or written.");
    return;
  }

  mkdirSync(bucketRoot, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  // 1. The database. Written to a temporary name and renamed once verified, so a
  // killed run never leaves a truncated file that looks like a backup.
  const partial = `${dumpFile}.partial`;
  const dump = spawnSync("pg_dump", pgDumpArgs(partial), {
    env: { ...env, ...pgEnv },
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (dump.error) throw new Error(`Could not run pg_dump: ${dump.error.message}`);
  if (dump.status !== 0) {
    rmSync(partial, { force: true });
    throw new Error(`pg_dump exited ${dump.status}. Its client must be at least the server's major version.`);
  }
  const listing = spawnSync("pg_restore", ["--list", partial], { encoding: "utf8" });
  if (listing.status !== 0 || !listing.stdout.includes("TABLE DATA")) {
    rmSync(partial, { force: true });
    throw new Error("The dump did not verify: pg_restore --list found no table data.");
  }
  chmodSync(partial, 0o600);
  renameSync(partial, dumpFile);
  console.log(`[backup] dump verified, ${statSync(dumpFile).size} bytes.`);

  // 2. The bucket. Objects are only added or replaced when their size changed.
  // Each one still in the bucket is stamped with this run's start, so an object
  // deleted in production is kept only as long as the dumps that knew it.
  const objects = await listBucketObjects({ baseUrl, key, bucket });
  let fetched = 0;
  for (const object of objects) {
    const target = safeObjectPath(bucketRoot, object.path);
    if (existsSync(target) && object.size !== null && statSync(target).size === object.size) {
      utimesSync(target, startedAt, startedAt);
      continue;
    }
    const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${object.path.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { authorization: `Bearer ${key}`, apikey: key },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Downloading ${object.path} answered ${response.status}.`);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
    utimesSync(target, startedAt, startedAt);
    fetched += 1;
  }
  console.log(`[backup] bucket ${bucket}: ${objects.length} objects, ${fetched} downloaded.`);

  // 3. Retention, by age. It runs only here, so the schedule keeps the window.
  const pruned = pruneBackupCopy({ dir, bucketRoot, now: Date.now() });
  console.log(
    `[backup] past retention: ${pruned.dumps} dumps, ${pruned.files} bucket files, ${pruned.directories} folders removed.`,
  );
  console.log("[backup] done.");
}

try {
  await runBackup();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backup] FAILED: ${message}`);
  const webhook = env.PUBMAX_ALERT_WEBHOOK_URL?.trim();
  if (webhook && !dryRun) {
    const text = "[pubmax][backup] The off-platform backup failed. The reason is in the log on the backup machine.";
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text, text }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  process.exit(1);
}
