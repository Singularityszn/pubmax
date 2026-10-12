import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DUMP_SCHEMAS,
  dumpFileName,
  isInsideDirectory,
  listBucketObjects,
  MAX_RETENTION_WEEKS,
  objectNeedsDownload,
  pgDumpArgs,
  pgEnvFromUrl,
  pruneBackupCopy,
  PRUNE_AFTER_WEEKS,
  safeObjectPath,
} from "@/scripts/lib/offPlatformBackup.mjs";

const ROOT = path.resolve(__dirname, "..");

describe("pgEnvFromUrl", () => {
  it("splits a connection string into PG variables so the password is never an argument", () => {
    expect(pgEnvFromUrl("postgresql://postgres.ref:p%40ss@aws-0.pooler.supabase.com:5432/postgres")).toEqual({
      PGHOST: "aws-0.pooler.supabase.com",
      PGPORT: "5432",
      PGUSER: "postgres.ref",
      PGPASSWORD: "p@ss",
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
    });
    expect(pgDumpArgs("/x/out.dump").join(" ")).not.toMatch(/p@ss|postgresql:/);
  });
  it("refuses anything that is not a postgres URL", () => {
    expect(() => pgEnvFromUrl("https://example.com")).toThrow(/postgres/);
    expect(() => pgEnvFromUrl("not a url")).toThrow();
  });
});

describe("dump files", () => {
  it("names a dump by UTC stamp and dumps the four schemas in custom format", () => {
    expect(dumpFileName(new Date("2026-10-06T07:30:05.123Z"))).toBe("pubmax-20261006T073005Z.dump");
    const args = pgDumpArgs("out.dump");
    expect(args).toContain("--format=custom");
    expect(DUMP_SCHEMAS).toEqual(["public", "auth", "storage", "supabase_migrations"]);
    for (const schema of DUMP_SCHEMAS) expect(args).toContain(schema);
  });
});

describe("pruneBackupCopy keeps no copy for 8 weeks, by age, on irregular runs", () => {
  const now = Date.parse("2026-10-06T03:30:00Z");
  let dir = "";
  let bucketRoot = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "backup-prune-"));
    bucketRoot = path.join(dir, "bucket", "pint-drops");
    mkdirSync(bucketRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (iso: string) => writeFileSync(path.join(dir, dumpFileName(new Date(iso))), "dump");
  const object = (relative: string, lastSeenIso: string) => {
    const file = path.join(bucketRoot, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "photo");
    const seen = new Date(lastSeenIso);
    utimesSync(file, seen, seen);
  };
  const tree = (root: string) => (readdirSync(root, { recursive: true }) as string[]).sort();

  it("prunes at 7 weeks, a week inside the 8 the privacy page promises", () => {
    expect(PRUNE_AFTER_WEEKS).toBe(7);
    expect(MAX_RETENTION_WEEKS).toBe(8);
  });

  it("deletes dumps past the window however many runs there were, killed partial dumps, and the photos and id folders only they named", () => {
    for (const iso of ["2026-03-01T03:30:00Z", "2026-07-20T03:30:00Z", "2026-08-17T03:30:00Z", "2026-08-19T03:30:00Z", "2026-10-06T03:30:00Z"]) {
      run(iso);
    }
    writeFileSync(path.join(dir, "notes.txt"), "mine");
    writeFileSync(path.join(dir, "pubmax-20260301T033000Z.dump.partial"), "half");
    object("profiles/account-a/1/a.jpg", "2026-03-01T03:30:00.400Z");
    object("profiles/account-c/2/c.jpg", "2026-08-17T03:30:00.400Z");
    object("profiles/account-b/1/b.jpg", "2026-08-19T03:30:00.400Z");
    object("messages/conversation-1/m.jpg", "2026-10-06T03:30:00.400Z");

    expect(pruneBackupCopy({ dir, bucketRoot, now })).toEqual({ dumps: 4, files: 2, directories: 4 });

    expect(readdirSync(dir).sort()).toEqual([
      "bucket",
      "notes.txt",
      "pubmax-20260819T033000Z.dump",
      "pubmax-20261006T033000Z.dump",
    ]);
    expect(tree(bucketRoot)).toEqual(
      [
        "messages",
        "messages/conversation-1",
        "messages/conversation-1/m.jpg",
        "profiles",
        "profiles/account-b",
        "profiles/account-b/1",
        "profiles/account-b/1/b.jpg",
      ].map((entry) => entry.split("/").join(path.sep)),
    );
  });

  it("removes a deleted account within 8 weeks when the run before its deletion fired late", () => {
    const lateRun = "2026-08-09T11:00:00Z";
    const deletedAt = Date.parse("2026-08-09T12:00:00Z");
    run(lateRun);
    for (const iso of ["2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"]) {
      run(`${iso}T03:30:00Z`);
    }
    object("profiles/deleted-account/1/a.jpg", "2026-08-09T11:00:00.400Z");
    object("profiles/live-account/1/b.jpg", "2026-10-04T03:30:00.400Z");
    const sunday = Date.parse("2026-10-04T03:30:00Z");

    pruneBackupCopy({ dir, bucketRoot, now: sunday });

    expect(sunday - deletedAt).toBeLessThan(8 * 7 * 24 * 60 * 60 * 1000);
    expect(readdirSync(dir)).not.toContain(dumpFileName(new Date(lateRun)));
    expect(tree(bucketRoot)).toEqual(
      ["profiles", "profiles/live-account", "profiles/live-account/1", "profiles/live-account/1/b.jpg"].map((entry) =>
        entry.split("/").join(path.sep),
      ),
    );
  });

  it("removes even the newest dump and its photos when the runs stopped beyond eight weeks", () => {
    run("2026-03-01T03:30:00Z");
    run("2026-05-01T03:30:00Z");
    object("old/a.jpg", "2026-03-01T03:30:00.400Z");
    object("newest/b.jpg", "2026-05-01T03:30:00.400Z");

    expect(pruneBackupCopy({ dir, bucketRoot, now })).toEqual({ dumps: 2, files: 2, directories: 2 });

    expect(readdirSync(dir).sort()).toEqual(["bucket"]);
    expect(tree(bucketRoot)).toEqual([]);
  });

  it("expires orphaned photos even without dumps and keeps the bucket root", () => {
    object("a.jpg", "2026-01-01T00:00:00Z");
    object("fresh.jpg", "2026-10-05T00:00:00Z");
    expect(pruneBackupCopy({ dir, bucketRoot, now })).toEqual({ dumps: 0, files: 1, directories: 0 });
    expect(tree(bucketRoot)).toEqual(["fresh.jpg"]);
    run("2026-10-06T03:30:00Z");
    pruneBackupCopy({ dir, bucketRoot, now });
    expect(existsSync(bucketRoot)).toBe(true);
  });

  it.each([
    ["2026-08-11T03:30:01Z", true],
    ["2026-08-11T03:30:00Z", false],
    ["2026-08-11T03:29:59Z", false],
  ] as const)("keeps the newest dump and photo from %s only before their eight-week deadline", (taken, retained) => {
    run(taken);
    object("account/photo.jpg", taken);

    pruneBackupCopy({ dir, bucketRoot, now });

    expect(existsSync(path.join(dir, dumpFileName(new Date(taken))))).toBe(retained);
    expect(existsSync(path.join(bucketRoot, "account/photo.jpg"))).toBe(retained);
    expect(existsSync(path.join(bucketRoot, "account"))).toBe(retained);
  });

  it("protects the unexpired newest fallback beyond seven weeks and trims deleted photo identifiers", () => {
    run("2026-03-01T03:30:00Z");
    run("2026-08-12T03:30:00Z");
    object("expired-account/old.jpg", "2026-03-01T03:30:00Z");
    object("fallback-account/photo.jpg", "2026-08-12T03:30:00Z");
    const versionsFile = path.join(dir, "bucket/pint-drops.versions.json");
    writeFileSync(versionsFile, JSON.stringify({
      "expired-account/old.jpg": "old-version",
      "missing-account/photo.jpg": "missing-version",
      "fallback-account/photo.jpg": "fallback-version",
    }));

    pruneBackupCopy({ dir, bucketRoot, now });

    expect(readdirSync(dir).sort()).toEqual(["bucket", "pubmax-20260812T033000Z.dump"]);
    expect(tree(bucketRoot)).toEqual(["fallback-account", path.join("fallback-account", "photo.jpg")]);
    expect(JSON.parse(readFileSync(versionsFile, "utf8"))).toEqual({ "fallback-account/photo.jpg": "fallback-version" });
    expect(statSync(versionsFile).mode & 0o777).toBe(0o600);
  });

  it("expires partial dumps and incoming photos without completed dumps or surviving identifier metadata", () => {
    const expired = path.join(dir, "pubmax-20260811T033000Z.dump.partial");
    const unexpired = path.join(dir, "pubmax-20260930T033000Z.dump.partial");
    writeFileSync(expired, "fixture-partial");
    writeFileSync(unexpired, "fixture-partial");
    // A recent filesystem timestamp must not extend an old dump's named age.
    utimesSync(expired, new Date(now), new Date(now));
    writeFileSync(path.join(dir, "notes.txt"), "operator note");
    object("expired/account/photo.jpg.incoming", "2026-08-11T03:30:00Z");
    object("fallback/account/photo.jpg.incoming", "2026-09-30T03:30:00Z");
    mkdirSync(path.join(bucketRoot, "empty-account"));
    const versionsFile = path.join(dir, "bucket/pint-drops.versions.json");
    writeFileSync(versionsFile, JSON.stringify({ "expired/account/photo.jpg": "old-version" }));

    expect(pruneBackupCopy({ dir, bucketRoot, now })).toEqual({ dumps: 1, files: 1, directories: 3 });

    expect(existsSync(expired)).toBe(false);
    expect(existsSync(unexpired)).toBe(true);
    expect(existsSync(versionsFile)).toBe(false);
    expect(readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe("operator note");
    expect(tree(bucketRoot)).toEqual([
      "fallback", path.join("fallback", "account"), path.join("fallback", "account", "photo.jpg.incoming"),
    ]);
  });

  it("removes identifier metadata when no photo or dump remains", () => {
    const versionsFile = path.join(dir, "bucket/pint-drops.versions.json");
    writeFileSync(versionsFile, JSON.stringify({ "deleted-account/photo.jpg": "old-version" }));

    pruneBackupCopy({ dir, bucketRoot, now });

    expect(existsSync(versionsFile)).toBe(false);
    expect(tree(bucketRoot)).toEqual([]);
  });
});

describe("keeping a backup out of the repository", () => {
  it("knows what is inside a directory", () => {
    expect(isInsideDirectory("/repo/backups", "/repo")).toBe(true);
    expect(isInsideDirectory("/repo", "/repo")).toBe(true);
    expect(isInsideDirectory("/home/me/pubmax-backups", "/repo")).toBe(false);
    expect(isInsideDirectory("/repo-other", "/repo")).toBe(false);
  });
  it("refuses a bucket path that escapes its directory", () => {
    expect(safeObjectPath("/b", "a/b.jpg")).toBe("/b/a/b.jpg");
    expect(() => safeObjectPath("/b", "../etc/passwd")).toThrow(/escaped/);
    expect(() => safeObjectPath("/b", "")).toThrow(/escaped/);
  });
});

describe("objectNeedsDownload", () => {
  const same = { exists: true, localSize: 10, size: 10, version: '"v1"', recordedVersion: '"v1"' };
  it("trusts a file only when its size and its recorded version both match", () => {
    expect(objectNeedsDownload(same)).toBe(false);
  });
  it("downloads a replacement that kept the same size", () => {
    expect(objectNeedsDownload({ ...same, version: '"v2"' })).toBe(true);
  });
  it("downloads a missing file, a resized file, an unrecorded file and an object with no version", () => {
    expect(objectNeedsDownload({ ...same, exists: false })).toBe(true);
    expect(objectNeedsDownload({ ...same, localSize: 9 })).toBe(true);
    expect(objectNeedsDownload({ ...same, recordedVersion: undefined })).toBe(true);
    expect(objectNeedsDownload({ ...same, version: null })).toBe(true);
  });
});

describe("listBucketObjects", () => {
  it("walks folders and pages, and returns files only", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { prefix, offset } = JSON.parse(String(init.body));
      if (prefix === "" && offset === 0) {
        return Response.json([
          { name: "a.jpg", id: "1", metadata: { size: 10, eTag: '"abc"' } },
          { name: "folder", id: null },
        ]);
      }
      if (prefix === "folder") return Response.json([{ name: "b.jpg", id: "2", updated_at: "2026-10-01T00:00:00Z", metadata: { size: 20 } }]);
      return Response.json([]);
    });
    const objects = await listBucketObjects({
      baseUrl: "https://x.supabase.co",
      key: "k",
      bucket: "pint-drops",
      fetchImpl: fetchImpl as never,
    });
    expect(objects).toEqual([
      { path: "a.jpg", size: 10, version: '"abc"' },
      { path: "folder/b.jpg", size: 20, version: "2026-10-01T00:00:00Z" },
    ]);
  });
  it("fails on an API error without echoing the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 403 }));
    const error = await listBucketObjects({
      baseUrl: "https://x.supabase.co",
      key: "secret-key",
      bucket: "b",
      fetchImpl: fetchImpl as never,
    }).catch((e) => e);
    expect(error.message).toContain("403");
    expect(error.message).not.toContain("secret-key");
  });
});

describe("npm run backup:offplatform", () => {
  const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
  const [command, script] = String(scripts["backup:offplatform"]).split(" ");
  let scratch = "";

  beforeEach(() => {
    scratch = mkdtempSync(path.join(os.tmpdir(), "backup-dir-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  const dryRun = (backupDir: string) =>
    spawnSync(String(command), [String(script), "--dry-run"], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        HOME: os.homedir(),
        PUBMAX_BACKUP_DIR: backupDir,
        PUBMAX_BACKUP_DB_URL: "postgresql://postgres.ref:pw@db.example.test:5432/postgres",
        SUPABASE_URL: "https://ref.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      },
    });

  it("is a node script", () => {
    expect(command).toBe("node");
  });

  it("plans a backup into a directory outside every checkout, even one not made yet", () => {
    const result = dryRun(path.join(scratch, "not", "made", "yet"));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dry run: nothing was read or written.");
    expect(result.stdout).not.toContain("pw@");
  });

  it("refuses a directory inside a git checkout, even one whose parents are not made yet", () => {
    execFileSync("git", ["init", "--quiet", scratch], {
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: os.homedir() },
    });
    mkdirSync(path.join(scratch, "existing"));
    for (const dir of [scratch, path.join(scratch, "existing"), path.join(scratch, "backups", "weekly", "deep")]) {
      const result = dryRun(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("PUBMAX_BACKUP_DIR is inside a git checkout.");
    }
  });
});

describe("git keeps a backup out of a commit", () => {
  const ignored = (file: string) =>
    spawnSync("git", ["check-ignore", "--quiet", "--no-index", file], { cwd: ROOT }).status === 0;

  it("ignores a dump anywhere in the tree and the default backup directory at the root", () => {
    expect(ignored("pubmax-20261006T073005Z.dump")).toBe(true);
    expect(ignored("scripts/pubmax-20261006T073005Z.dump")).toBe(true);
    expect(ignored("pubmax-backups/bucket/pint-drops/user/photo.jpg")).toBe(true);
  });
});
