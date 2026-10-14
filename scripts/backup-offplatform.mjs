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
  mkdtempSync,
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

function publishGeneration(copies, stage, startedAt) {
  const journal = [];
  let originalIndex = null;
  try {
    const indexCopy = copies.find((copy) => copy.recoveryIndex);
    if (indexCopy && existsSync(indexCopy.target)) {
      originalIndex = { incoming: indexCopy.incoming, stat: statSync(indexCopy.target), data: readFileSync(indexCopy.target) };
    }
    for (const [index, copy] of copies.entries()) {
      const original = existsSync(copy.target) ? statSync(copy.target) : null;
      if (original && !original.isFile()) throw new Error("Backup publication target is not a file.");
      const entry = {
        ...copy, original, previous: path.join(stage, `previous-${index}`), moved: false, published: false,
      };
      journal.push(entry);
      if (copy.incoming) {
        mkdirSync(path.dirname(copy.target), { recursive: true, mode: 0o700 });
        if (original) {
          renameSync(copy.target, entry.previous);
          entry.moved = true;
        }
        renameSync(copy.incoming, copy.target);
        entry.published = true;
      }
      if (copy.stamp) utimesSync(copy.target, startedAt, startedAt);
    }
  } catch {
    let rollbackFailed = false;
    for (const entry of journal.reverse()) {
      try {
        if (entry.published) rmSync(entry.target, { force: true });
        if (entry.moved) renameSync(entry.previous, entry.target);
        else if (entry.original && entry.stamp) utimesSync(entry.target, entry.original.atime, entry.original.mtime);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) {
      let preservationFailed = false;
      for (const entry of journal) {
        try {
          // Reuse the staged object paths so retained originals keep their mapping.
          if (entry.stamp && entry.moved && existsSync(entry.previous)) renameSync(entry.previous, entry.incoming);
        } catch {
          preservationFailed = true;
        }
      }
      // Finally pruning may remove a restored index when a photo is still absent.
      if (originalIndex) {
        try {
          writeFileSync(originalIndex.incoming, originalIndex.data, { mode: 0o600 });
          utimesSync(originalIndex.incoming, originalIndex.stat.atimeMs / 1000, originalIndex.stat.mtimeMs / 1000);
        } catch {
          preservationFailed = true;
        }
      }
      const error = new Error(preservationFailed
        ? "Backup publication rollback failed. Recovery metadata is incomplete. Available originals remain in private staging."
        : "Backup publication rollback failed. Recoverable originals and their metadata remain in private staging.");
      error.preserveStaging = true;
      throw error;
    }
    throw new Error("Backup publication failed. The previous generation was retained.");
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

  const bucketRoot = path.join(dir, "bucket", bucket);
  if (!dryRun && existsSync(dir)) {
    mkdirSync(bucketRoot, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    pruneBackupCopy({ dir, bucketRoot, now: Date.now() });
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

  console.log(`[backup] directory ${dir}`);
  console.log(`[backup] dump ${path.basename(dumpFile)} from ${pgEnv.PGHOST}; bucket ${bucket}; prune after ${PRUNE_AFTER_WEEKS} weeks; maximum ${MAX_RETENTION_WEEKS} weeks`);
  if (dryRun) {
    console.log("[backup] dry run: nothing was read or written.");
    return;
  }

  mkdirSync(bucketRoot, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  const partial = `${dumpFile}.partial`;
  let stage;
  let preserveStaging = false;
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

    // 2. Download replacements privately before changing the published copy.
    stage = mkdtempSync(path.join(dir, ".backup-stage-"));
    chmodSync(stage, 0o700);
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
    const copies = [];
    let fetched = 0;
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
        copies.push({ target, incoming: null, stamp: true });
        continue;
      }
      const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${object.path.split("/").map(encodeURIComponent).join("/")}`, {
        headers: { authorization: `Bearer ${key}`, apikey: key },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Downloading a bucket object answered ${response.status}.`);
      const incoming = safeObjectPath(path.join(stage, "photos"), object.path);
      mkdirSync(path.dirname(incoming), { recursive: true, mode: 0o700 });
      writeFileSync(incoming, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
      copies.push({ target, incoming, stamp: true });
      versions[object.path] = object.version;
      fetched += 1;
    }
    const stagedVersions = path.join(stage, "versions.json");
    writeFileSync(stagedVersions, JSON.stringify(versions), { mode: 0o600 });
    copies.push({ target: versionsFile, incoming: stagedVersions, stamp: false, recoveryIndex: true });
    // Publish the dump last. Originals remain private until every promotion succeeds.
    copies.push({ target: dumpFile, incoming: partial, stamp: false });
    try {
      publishGeneration(copies, stage, startedAt);
    } catch (error) {
      preserveStaging = error.preserveStaging === true;
      throw error;
    }
    console.log(`[backup] bucket ${bucket}: ${objects.length} objects, ${fetched} downloaded.`);

    console.log(`[backup] dump verified, ${statSync(dumpFile).size} bytes.`);
  } finally {
    // Failed renewal, dump or Storage still expires data at the current time.
    rmSync(partial, { force: true });
    if (stage && !preserveStaging) rmSync(stage, { recursive: true, force: true });
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
