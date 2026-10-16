#!/usr/bin/env node
// npm run backup:offplatform - a pg_dump plus a sync of the pint-drops bucket,
// written to a private directory on this machine, never into the repository.
// The rules are scripts/lib/offPlatformBackup.mjs and the restore is
// docs/DR_RUNBOOK.md. scripts/install-backup-launchd.mjs schedules it weekly.
//
// Environment configuration is documented in docs/DR_RUNBOOK.md#take-it.
// `--dry-run` prints the plan and touches nothing.

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  cliLoginConfig,
  cliReadOnlyPgEnv,
  DEFAULT_BUCKET,
  dumpFileName,
  lastCompleteBackupPastMaximum,
  listBucketObjects,
  MAX_RETENTION_WEEKS,
  objectNeedsDownload,
  pgDumpArgs,
  pgEnvFromUrl,
  pruneBackupCopy,
  PRUNE_AFTER_WEEKS,
  safeObjectPath,
} from "./lib/offPlatformBackup.mjs";

const dryRun = process.argv.includes("--dry-run");
const env = process.env;
// Set once the destination is known to be outside every checkout, so a failure
// can say whether the last good backup is being held past the maximum.
let backupDir = null;

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
  let pgEnv = pgEnvFromUrl(dbUrl);
  const baseUrl = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const auth = env.PUBMAX_BACKUP_DB_AUTH?.trim() || "password";
  if (auth !== "password" && auth !== "cli-read-only") throw new Error("PUBMAX_BACKUP_DB_AUTH must be password or cli-read-only.");
  const loginConfig = auth === "cli-read-only" ? cliLoginConfig({ dbUrl, baseUrl }) : null;
  const token = loginConfig ? requireEnv("SUPABASE_ACCESS_TOKEN") : null;
  const startedAt = new Date();
  const dumpFile = path.join(dir, dumpFileName(startedAt));
  const bucketRoot = path.join(dir, "bucket", bucket);
  // Replacement photos land here first, beside the retained copy, and move
  // into bucketRoot only after the whole sync succeeds. A Storage failure
  // halfway through therefore never overwrites a photo the last complete dump
  // still names.
  const stagingRoot = path.join(dir, "bucket", `${bucket}.staging`);

  console.log(`[backup] directory ${dir}`);
  console.log(`[backup] dump ${path.basename(dumpFile)} from ${pgEnv.PGHOST}; bucket ${bucket}; prune after ${PRUNE_AFTER_WEEKS} weeks; maximum ${MAX_RETENTION_WEEKS} weeks`);
  if (dryRun) {
    console.log("[backup] dry run: nothing was read or written.");
    return;
  }

  mkdirSync(bucketRoot, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  backupDir = dir;
  // A killed run's staged photos belong to no dump.
  rmSync(stagingRoot, { recursive: true, force: true });

  // 0. Retention first. Pruning must not wait on a dump that may fail, so a
  // database outage cannot preserve an expired fallback or its photo identifiers.
  pruneBackupCopy({ dir, bucketRoot, now: Date.now() });

  const partial = `${dumpFile}.partial`;
  try {
    if (loginConfig) pgEnv = await cliReadOnlyPgEnv({ config: loginConfig, token });

    // 1. The database. Verify the temporary dump before syncing photos, then
    // publish it only after the complete copy succeeds.
    const childEnv = { ...env };
    delete childEnv.SUPABASE_ACCESS_TOKEN;
    delete childEnv.SUPABASE_SERVICE_ROLE_KEY;
    delete childEnv.PUBMAX_BACKUP_DB_URL;
    delete childEnv.PUBMAX_ALERT_WEBHOOK_URL;
    const dumpArgs = pgDumpArgs(partial);
    // Supabase's managed read-only role grants full reads and bypasses RLS.
    // The temporary login need not inherit it. Never step down to postgres here.
    if (loginConfig) dumpArgs.push("--role=supabase_read_only_user", "--no-password");
    const dump = spawnSync("pg_dump", dumpArgs, {
      env: { ...childEnv, ...pgEnv },
      // A client error can contain connection credentials or database identifiers.
      stdio: loginConfig ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    });
    if (dump.error) {
      throw new Error("Could not run pg_dump.");
    }
    if (dump.status !== 0) {
      throw new Error(`pg_dump exited ${dump.status}. Its client must be at least the server's major version.`);
    }
    const listing = spawnSync("pg_restore", ["--list", partial], { encoding: "utf8", env: childEnv });
    if (listing.status !== 0 || !listing.stdout.includes("TABLE DATA")) {
      throw new Error("The dump did not verify: pg_restore --list found no table data.");
    }
    chmodSync(partial, 0o600);

    // 2. The bucket. Size and recorded version detect replacements under the same key.
    // Each one still in the bucket is stamped with this run's start, so an object
    // deleted in production is kept only as long as the dumps that knew it.
    const objects = await listBucketObjects({ baseUrl, key, bucket });
    // What each local file was when it was fetched, so a replacement under the
    // same key and the same size is still noticed.
    const versionsFile = path.join(dir, "bucket", `${bucket}.versions.json`);
    let recorded = {};
    try {
      recorded = JSON.parse(readFileSync(versionsFile, "utf8"));
    } catch {
      recorded = {};
    }
    const versions = {};
    const unchanged = [];
    const staged = [];
    mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
    for (const object of objects) {
      const target = safeObjectPath(bucketRoot, object.path);
      const present = existsSync(target);
      if (
        !objectNeedsDownload({
          exists: present,
          localSize: present ? statSync(target).size : 0,
          size: object.size,
          version: object.version,
          recordedVersion: recorded[object.path],
        })
      ) {
        versions[object.path] = object.version;
        unchanged.push(target);
        continue;
      }
      const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${object.path.split("/").map(encodeURIComponent).join("/")}`, {
        headers: { authorization: `Bearer ${key}`, apikey: key },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Downloading a bucket object answered ${response.status}.`);
      const stagedFile = safeObjectPath(stagingRoot, object.path);
      mkdirSync(path.dirname(stagedFile), { recursive: true, mode: 0o700 });
      writeFileSync(stagedFile, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
      staged.push({ stagedFile, target });
      versions[object.path] = object.version;
    }

    // Every object read. Only now does the copy change: the staged photos
    // replace the retained ones, each by one rename, and every object still in
    // the bucket is stamped as seen by this run.
    for (const { stagedFile, target } of staged) {
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      renameSync(stagedFile, target);
      utimesSync(target, startedAt, startedAt);
    }
    for (const target of unchanged) utimesSync(target, startedAt, startedAt);
    writeFileSync(versionsFile, JSON.stringify(versions), { mode: 0o600 });
    console.log(`[backup] bucket ${bucket}: ${objects.length} objects, ${staged.length} downloaded.`);

    // Publish only after Storage completes, so its failure preserves the last
    // complete fallback on this run and the next. The archive is already verified.
    renameSync(partial, dumpFile);
    console.log(`[backup] dump verified, ${statSync(dumpFile).size} bytes.`);
  } finally {
    // Failed renewal, dump or Storage still expires data at the current time.
    rmSync(partial, { force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
    const pruned = pruneBackupCopy({ dir, bucketRoot, now: Date.now() });
    console.log(
      `[backup] past retention: ${pruned.dumps} dumps, ${pruned.files} bucket files, ${pruned.directories} folders removed.`,
    );
  }
  console.log("[backup] done.");
}

try {
  await runBackup();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backup] FAILED: ${message}`);
  // The last good backup is never deleted, so when newer runs keep failing it
  // outlives the eight-week maximum. That is a promise being broken, so the
  // alert says it.
  const heldSince = backupDir ? lastCompleteBackupPastMaximum({ dir: backupDir, now: Date.now() }) : null;
  if (heldSince) {
    console.error(`[backup] The last complete backup, taken ${heldSince}, is past the ${MAX_RETENTION_WEEKS}-week maximum. It is kept because no newer backup has completed.`);
  }
  const webhook = env.PUBMAX_ALERT_WEBHOOK_URL?.trim();
  if (webhook && !dryRun) {
    const text = heldSince
      ? `[pubmax][backup] The off-platform backup failed, and the last complete backup (${heldSince}) is past the ${MAX_RETENTION_WEEKS}-week maximum. It is kept until a newer backup completes. The reason is in the log on the backup machine.`
      : "[pubmax][backup] The off-platform backup failed. The reason is in the log on the backup machine.";
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text, text }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  process.exit(1);
}
