import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bucketFilesToPrune,
  DEFAULT_KEEP,
  DUMP_SCHEMAS,
  dumpFileName,
  dumpsToPrune,
  dumpTakenAt,
  isInsideDirectory,
  listBucketObjects,
  pgDumpArgs,
  pgEnvFromUrl,
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
  it("prunes only old dumps and never another file", () => {
    const files = [
      "pubmax-20260901T000000Z.dump",
      "pubmax-20260908T000000Z.dump",
      "pubmax-20260915T000000Z.dump",
      "notes.txt",
      "bucket",
      "pubmax-20260915T000000Z.dump.partial",
    ];
    expect(dumpsToPrune(files, 2)).toEqual(["pubmax-20260901T000000Z.dump"]);
    expect(dumpsToPrune(files, DEFAULT_KEEP)).toEqual([]);
  });
  it("reads when a dump was taken from its name, and nothing from any other file", () => {
    expect(dumpTakenAt(dumpFileName(new Date("2026-10-06T07:30:05.123Z")))).toBe(Date.parse("2026-10-06T07:30:05Z"));
    expect(dumpTakenAt("pubmax-20261006T073005Z.dump.partial")).toBeNull();
    expect(dumpTakenAt("notes.txt")).toBeNull();
  });
});

describe("the bucket copy keeps nothing longer than the dumps", () => {
  const kept = ["pubmax-20260908T000000Z.dump", "pubmax-20260915T000000Z.dump", "bucket", "notes.txt"];
  it("prunes a file last seen before the oldest kept dump, and keeps one the kept dumps can name", () => {
    const local = [
      { path: "/b/gone-long-ago.jpg", lastSeenMs: Date.parse("2026-09-01T00:00:00Z") },
      { path: "/b/seen-at-oldest-dump.jpg", lastSeenMs: Date.parse("2026-09-08T00:00:00.400Z") },
      { path: "/b/still-in-bucket.jpg", lastSeenMs: Date.parse("2026-09-15T00:00:00.400Z") },
    ];
    expect(bucketFilesToPrune(local, kept)).toEqual(["/b/gone-long-ago.jpg"]);
  });
  it("prunes nothing when no dump is kept", () => {
    expect(bucketFilesToPrune([{ path: "/b/a.jpg", lastSeenMs: 0 }], ["bucket"])).toEqual([]);
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

describe("listBucketObjects", () => {
  it("walks folders and pages, and returns files only", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { prefix, offset } = JSON.parse(String(init.body));
      if (prefix === "" && offset === 0) {
        return Response.json([
          { name: "a.jpg", id: "1", metadata: { size: 10 } },
          { name: "folder", id: null },
        ]);
      }
      if (prefix === "folder") return Response.json([{ name: "b.jpg", id: "2", metadata: { size: 20 } }]);
      return Response.json([]);
    });
    const objects = await listBucketObjects({
      baseUrl: "https://x.supabase.co",
      key: "k",
      bucket: "pint-drops",
      fetchImpl: fetchImpl as never,
    });
    expect(objects).toEqual([
      { path: "a.jpg", size: 10 },
      { path: "folder/b.jpg", size: 20 },
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
