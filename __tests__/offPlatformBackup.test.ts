import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bucketCommitPaths,
  commitBucketSync,
  DUMP_SCHEMAS,
  dumpFileName,
  isInsideDirectory,
  lastCompleteBackupPastMaximum,
  listBucketObjects,
  MAX_RETENTION_WEEKS,
  objectNeedsDownload,
  pgDumpArgs,
  pgEnvFromUrl,
  pruneBackupCopy,
  PRUNE_AFTER_WEEKS,
  safeObjectPath,
  settleInterruptedCommit,
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

describe("pruneBackupCopy keeps no copy past 8 weeks once a newer backup completes, by age, on irregular runs", () => {
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

  it("never deletes the last good backup when the runs stopped beyond eight weeks, and names it past the maximum", () => {
    run("2026-03-01T03:30:00Z");
    run("2026-05-01T03:30:00Z");
    object("old/a.jpg", "2026-03-01T03:30:00.400Z");
    object("newest/b.jpg", "2026-05-01T03:30:00.400Z");

    expect(pruneBackupCopy({ dir, bucketRoot, now })).toEqual({ dumps: 1, files: 1, directories: 1 });

    expect(readdirSync(dir).sort()).toEqual(["bucket", "pubmax-20260501T033000Z.dump"]);
    expect(tree(bucketRoot)).toEqual(["newest", path.join("newest", "b.jpg")]);
    expect(lastCompleteBackupPastMaximum({ dir, now })).toBe("2026-05-01T03:30:00.000Z");
  });

  it("retires the held backup and the photos only it knew once a newer backup completes", () => {
    run("2026-05-01T03:30:00Z");
    object("deleted-account/a.jpg", "2026-05-01T03:30:00.400Z");
    pruneBackupCopy({ dir, bucketRoot, now });
    expect(readdirSync(dir)).toContain("pubmax-20260501T033000Z.dump");

    run("2026-10-06T03:30:00Z");
    object("live-account/b.jpg", "2026-10-06T03:30:00.400Z");
    pruneBackupCopy({ dir, bucketRoot, now });

    expect(readdirSync(dir).sort()).toEqual(["bucket", "pubmax-20261006T033000Z.dump"]);
    expect(tree(bucketRoot)).toEqual(["live-account", path.join("live-account", "b.jpg")]);
    expect(lastCompleteBackupPastMaximum({ dir, now })).toBeNull();
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
    ["2026-08-11T03:30:01Z", false],
    ["2026-08-11T03:30:00Z", true],
    ["2026-08-11T03:29:59Z", true],
  ] as const)("keeps the only complete dump and photo from %s, and holds it past the maximum from its eight-week deadline", (taken, pastMaximum) => {
    run(taken);
    object("account/photo.jpg", taken);

    pruneBackupCopy({ dir, bucketRoot, now });

    expect(existsSync(path.join(dir, dumpFileName(new Date(taken))))).toBe(true);
    expect(existsSync(path.join(bucketRoot, "account/photo.jpg"))).toBe(true);
    expect(lastCompleteBackupPastMaximum({ dir, now })).toBe(pastMaximum ? new Date(taken).toISOString() : null);
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

describe("the backup executable keeps the last complete copy whole when Storage fails", () => {
  const runFile = promisify(execFile);
  let scratch = "";
  let server: Server;
  let storageUrl = "";
  let objects: Record<string, { version: string; body: string; status: number }> = {};
  let alerts: string[] = [];

  beforeEach(async () => {
    scratch = mkdtempSync(path.join(os.tmpdir(), "backup-sync-"));
    objects = {};
    alerts = [];
    // Stand-ins for the PostgreSQL clients: a dump that verifies, so these
    // cases prove the Storage half without a cluster.
    const bin = path.join(scratch, "bin");
    mkdirSync(bin);
    // PUBMAX_FAKE_DUMP_FAILURES lists the stderr of each failing call in turn,
    // so a case can stage a refused connection before a good dump.
    writeFileSync(path.join(bin, "pg_dump"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const log = process.env.PUBMAX_FAKE_DUMP_LOG;
const calls = log && fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\\n").filter(Boolean).length : 0;
if (log) fs.appendFileSync(log, process.env.PGUSER + "\\n");
const failures = JSON.parse(process.env.PUBMAX_FAKE_DUMP_FAILURES || "[]");
if (calls < failures.length) { process.stderr.write(failures[calls]); process.exit(1); }
fs.writeFileSync(args[args.indexOf("--file") + 1], "fixture-dump");
`, { mode: 0o700 });
    writeFileSync(path.join(bin, "pg_restore"), "#!/usr/bin/env node\nconsole.log('TABLE DATA public profiles');\n", { mode: 0o700 });
    server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      if (request.url === "/alert") {
        alerts.push(body);
        response.writeHead(204).end();
        return;
      }
      if (request.url?.endsWith("/cli/login-role")) {
        response.writeHead(201, { "content-type": "application/json" })
          .end(JSON.stringify({ role: "cli_login_fixture", password: "fixture-login-secret", ttl_seconds: 300 }));
        return;
      }
      response.setHeader("content-type", "application/json");
      if (request.url?.startsWith("/storage/v1/object/list/")) {
        response.end(JSON.stringify(Object.entries(objects).map(([name, object]) => ({
          id: name,
          name,
          metadata: { size: object.body.length, eTag: object.version },
        }))));
        return;
      }
      const name = request.url?.split("/").at(-1) ?? "";
      const object = objects[name];
      if (!object) return void response.writeHead(404).end();
      if (object.status !== 200) return void response.writeHead(object.status).end("{}");
      response.end(object.body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The fixture server did not listen.");
    storageUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(scratch, { recursive: true, force: true });
  });

  const privateDir = () => path.join(scratch, "private");
  const photo = (name: string) => readFileSync(path.join(privateDir(), "bucket/pint-drops", name), "utf8");
  const versions = () => JSON.parse(readFileSync(path.join(privateDir(), "bucket/pint-drops.versions.json"), "utf8"));
  const dumps = () => readdirSync(privateDir()).filter((file) => file.endsWith(".dump"));

  async function backup(
    overrides: Record<string, string> = {},
    nodeArgs: string[] = [],
  ): Promise<{ status: number; output: string }> {
    try {
      const result = await runFile(process.execPath, [...nodeArgs, "scripts/backup-offplatform.mjs"], {
        cwd: ROOT,
        env: {
          NODE_ENV: "test",
          PATH: `${path.join(scratch, "bin")}:${process.env.PATH ?? ""}`,
          HOME: os.homedir(),
          PUBMAX_BACKUP_DIR: privateDir(),
          PUBMAX_BACKUP_DB_URL: "postgres://postgres:fixture-password@127.0.0.1:5432/postgres",
          SUPABASE_URL: storageUrl,
          SUPABASE_SERVICE_ROLE_KEY: "fixture-storage-secret",
          PUBMAX_ALERT_WEBHOOK_URL: `${storageUrl}/alert`,
          ...overrides,
        },
        timeout: 40_000,
      });
      return { status: 0, output: result.stdout + result.stderr };
    } catch (error) {
      const failed = error as { code: number; stdout: string; stderr: string };
      return { status: failed.code, output: failed.stdout + failed.stderr };
    }
  }

  it("never overwrites a retained photo when a later object in the same sync answers 503", async () => {
    objects = {
      "a.jpg": { version: "a1", body: "a-v1!", status: 200 },
      "b.jpg": { version: "b1", body: "b-v1!", status: 200 },
    };
    const first = await backup();
    expect(first.status, first.output).toBe(0);
    const fallback = dumps();
    expect(fallback).toHaveLength(1);

    // One successful same-key, same-size replacement, then a 503.
    objects = {
      "a.jpg": { version: "a2", body: "a-v2!", status: 200 },
      "b.jpg": { version: "b2", body: "b-v2!", status: 503 },
    };
    const failed = await backup();
    expect(failed.status).toBe(1);
    expect(failed.output).toContain("answered 503");
    expect(photo("a.jpg")).toBe("a-v1!");
    expect(photo("b.jpg")).toBe("b-v1!");
    expect(versions()).toEqual({ "a.jpg": "a1", "b.jpg": "b1" });
    expect(dumps()).toEqual(fallback);
    expect(readdirSync(path.join(privateDir(), "bucket")).sort()).toEqual(["pint-drops", "pint-drops.versions.json"]);
    expect(readdirSync(privateDir()).some((file) => file.endsWith(".partial"))).toBe(false);

    // The next whole sync swaps both in.
    objects["b.jpg"]!.status = 200;
    const recovered = await backup();
    expect(recovered.status, recovered.output).toBe(0);
    expect(photo("a.jpg")).toBe("a-v2!");
    expect(photo("b.jpg")).toBe("b-v2!");
    expect(versions()).toEqual({ "a.jpg": "a2", "b.jpg": "b2" });
    expect(existsSync(path.join(privateDir(), "bucket/pint-drops.staging"))).toBe(false);
  }, 60_000);

  it("keeps the only complete backup past eight weeks when newer runs fail, and says so in the alert", async () => {
    const taken = new Date("2026-01-04T03:30:00Z");
    const bucketRoot = path.join(privateDir(), "bucket/pint-drops");
    mkdirSync(path.join(bucketRoot, "account"), { recursive: true });
    writeFileSync(path.join(privateDir(), dumpFileName(taken)), "fixture-last-good-dump");
    writeFileSync(path.join(bucketRoot, "account/photo.jpg"), "last-good-photo");
    utimesSync(path.join(bucketRoot, "account/photo.jpg"), taken, taken);
    objects = { "a.jpg": { version: "a1", body: "a-v1!", status: 503 } };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await backup();
      expect(result.status).toBe(1);
      expect(result.output).toContain("past the 8-week maximum");
      expect(dumps()).toEqual([dumpFileName(taken)]);
      expect(readFileSync(path.join(bucketRoot, "account/photo.jpg"), "utf8")).toBe("last-good-photo");
    }
    expect(alerts).toHaveLength(2);
    for (const alert of alerts) {
      expect(alert).toContain(`last complete backup (${taken.toISOString()}) is past the 8-week maximum`);
      expect(alert).not.toContain("fixture-storage-secret");
      expect(alert).not.toContain("fixture-password");
    }
  }, 60_000);

  it("undoes a swap that a killed run left half done, before anything else reads the copy", async () => {
    objects = { "a.jpg": { version: "a1", body: "a-v1!", status: 200 } };
    expect((await backup()).status).toBe(0);
    const fallback = dumps();

    // What a run killed mid-commit leaves: the journal, the retained photo
    // moved aside, the new photo in its place, an added photo, and no dump.
    const bucketDir = path.join(privateDir(), "bucket");
    const { previousRoot, journalFile } = bucketCommitPaths(privateDir(), "pint-drops");
    mkdirSync(previousRoot, { recursive: true });
    writeFileSync(path.join(previousRoot, "a.jpg"), "a-v1!");
    writeFileSync(path.join(bucketDir, "pint-drops", "a.jpg"), "a-v2!");
    writeFileSync(path.join(bucketDir, "pint-drops", "new.jpg"), "new-1");
    writeFileSync(path.join(bucketDir, "pint-drops.versions.json"), JSON.stringify({ "a.jpg": "a2", "new.jpg": "n1" }));
    writeFileSync(journalFile, JSON.stringify({
      dump: "pubmax-20990101T000000Z.dump",
      added: ["new.jpg"],
      versionsBefore: JSON.stringify({ "a.jpg": "a1" }),
    }));

    objects = { "a.jpg": { version: "a2", body: "a-v2!", status: 503 } };
    const next = await backup();

    expect(next.status).toBe(1);
    expect(photo("a.jpg")).toBe("a-v1!");
    expect(existsSync(path.join(bucketDir, "pint-drops", "new.jpg"))).toBe(false);
    expect(versions()).toEqual({ "a.jpg": "a1" });
    expect(existsSync(previousRoot)).toBe(false);
    expect(existsSync(journalFile)).toBe(false);
    expect(dumps()).toEqual(fallback);
  }, 60_000);

  it("retries a refused pooler connection with a fresh login, and never a query error", async () => {
    const redirect = path.join(scratch, "redirect.mjs");
    writeFileSync(redirect, `
const realFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  if (!["api.supabase.com", "abcdefghijklmnopqrst.supabase.co"].includes(url.hostname)) throw new Error("Unexpected fixture request");
  return realFetch(${JSON.stringify("__BASE__")} + url.pathname, options);
};
`.replace("__BASE__", storageUrl));
    const pooler = {
      PUBMAX_BACKUP_DB_AUTH: "cli-read-only",
      PUBMAX_BACKUP_DB_URL: "postgres://postgres.abcdefghijklmnopqrst@aws-0-eu-west-2.pooler.supabase.com:5432/postgres",
      SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      SUPABASE_ACCESS_TOKEN: "fixture-management-secret",
      PUBMAX_ALERT_WEBHOOK_URL: "",
    };
    const refused = 'pg_dump: error: connection to server at "pooler" failed: FATAL:  password authentication failed for user "cli_login_fixture.abcdefghijklmnopqrst"';
    objects = { "a.jpg": { version: "a1", body: "a-v1!", status: 200 } };

    const log = path.join(scratch, "dump-calls.log");
    const retried = await backup(
      { ...pooler, PUBMAX_FAKE_DUMP_LOG: log, PUBMAX_FAKE_DUMP_FAILURES: JSON.stringify([refused]) },
      ["--import", redirect],
    );
    expect(retried.status, retried.output).toBe(0);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "cli_login_fixture.abcdefghijklmnopqrst",
      "cli_login_fixture.abcdefghijklmnopqrst",
    ]);
    expect(dumps()).toHaveLength(1);
    expect(retried.output).not.toContain("fixture-login-secret");

    const queryLog = path.join(scratch, "query-calls.log");
    const denied = await backup(
      {
        ...pooler,
        PUBMAX_FAKE_DUMP_LOG: queryLog,
        PUBMAX_FAKE_DUMP_FAILURES: JSON.stringify(["pg_dump: error: query failed: ERROR:  permission denied for table profiles"]),
      },
      ["--import", redirect],
    );
    expect(denied.status).toBe(1);
    expect(denied.output).toContain("pg_dump exited 1");
    expect(readFileSync(queryLog, "utf8").trim().split("\n")).toHaveLength(1);
  }, 60_000);
});

describe("commitBucketSync publishes the dump and its photos as one recoverable step", () => {
  let dir = "";
  let bucketRoot = "";
  let stagingRoot = "";
  let paths: ReturnType<typeof bucketCommitPaths> & { dir: string; bucketRoot: string; versionsFile: string };

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "backup-commit-"));
    bucketRoot = path.join(dir, "bucket", "pint-drops");
    stagingRoot = path.join(dir, "bucket", "pint-drops.staging");
    mkdirSync(bucketRoot, { recursive: true });
    mkdirSync(stagingRoot, { recursive: true });
    paths = { dir, bucketRoot, versionsFile: path.join(dir, "bucket", "pint-drops.versions.json"), ...bucketCommitPaths(dir, "pint-drops") };
    writeFileSync(path.join(dir, "pubmax-20261001T000000Z.dump"), "last-good");
    writeFileSync(path.join(bucketRoot, "a.jpg"), "a-old");
    writeFileSync(path.join(bucketRoot, "b.jpg"), "b-old");
    writeFileSync(paths.versionsFile, JSON.stringify({ "a.jpg": "a1", "b.jpg": "b1" }));
    for (const [name, body] of [["a.jpg", "a-new"], ["b.jpg", "b-new"], ["c.jpg", "c-new"]] as const) {
      writeFileSync(path.join(stagingRoot, name), body);
    }
    writeFileSync(path.join(dir, "pubmax-20261008T000000Z.dump.partial"), "next");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const commit = (rename?: (from: string, to: string) => void) => commitBucketSync({
    ...paths,
    staged: ["a.jpg", "b.jpg", "c.jpg"].map((name) => ({ stagedFile: path.join(stagingRoot, name), target: path.join(bucketRoot, name) })),
    unchanged: [],
    versions: { "a.jpg": "a2", "b.jpg": "b2", "c.jpg": "c1" },
    partialDump: path.join(dir, "pubmax-20261008T000000Z.dump.partial"),
    dumpFile: path.join(dir, "pubmax-20261008T000000Z.dump"),
    stamp: new Date("2026-10-08T00:00:00Z"),
    rename,
  });
  const read = (name: string) => readFileSync(path.join(bucketRoot, name), "utf8");

  it("swaps every photo, records the versions and publishes the dump", () => {
    commit();
    expect([read("a.jpg"), read("b.jpg"), read("c.jpg")]).toEqual(["a-new", "b-new", "c-new"]);
    expect(JSON.parse(readFileSync(paths.versionsFile, "utf8"))).toEqual({ "a.jpg": "a2", "b.jpg": "b2", "c.jpg": "c1" });
    expect(existsSync(path.join(dir, "pubmax-20261008T000000Z.dump"))).toBe(true);
    expect(existsSync(paths.previousRoot)).toBe(false);
    expect(existsSync(paths.journalFile)).toBe(false);
  });

  it("puts every retained photo and identifier back when a rename fails partway", () => {
    let calls = 0;
    const failing = (from: string, to: string) => {
      calls += 1;
      // a.jpg moves aside and its replacement lands; b.jpg's move aside fails.
      if (calls === 3) throw new Error("EIO");
      renameSync(from, to);
    };
    expect(() => commit(failing)).toThrow("EIO");
    expect([read("a.jpg"), read("b.jpg")]).toEqual(["a-old", "b-old"]);
    expect(existsSync(path.join(bucketRoot, "c.jpg"))).toBe(false);
    expect(JSON.parse(readFileSync(paths.versionsFile, "utf8"))).toEqual({ "a.jpg": "a1", "b.jpg": "b1" });
    expect(readdirSync(dir).filter((file) => file.endsWith(".dump"))).toEqual(["pubmax-20261001T000000Z.dump"]);
    expect(existsSync(paths.previousRoot)).toBe(false);
    expect(existsSync(paths.journalFile)).toBe(false);
  });

  it("keeps the new photos when the run died after the dump was published", () => {
    // A kill between the dump's rename and the clean-up.
    mkdirSync(paths.previousRoot, { recursive: true });
    writeFileSync(path.join(paths.previousRoot, "a.jpg"), "a-old");
    writeFileSync(path.join(bucketRoot, "a.jpg"), "a-new");
    writeFileSync(path.join(dir, "pubmax-20261008T000000Z.dump"), "next");
    writeFileSync(paths.journalFile, JSON.stringify({ dump: "pubmax-20261008T000000Z.dump", added: [], versionsBefore: "{}" }));

    expect(settleInterruptedCommit(paths)).toBe("committed");
    expect(read("a.jpg")).toBe("a-new");
    expect(existsSync(paths.previousRoot)).toBe(false);
  });

  it("drops the version index when the journal cannot be read, so nothing old is trusted", () => {
    mkdirSync(paths.previousRoot, { recursive: true });
    writeFileSync(path.join(paths.previousRoot, "a.jpg"), "a-old");
    writeFileSync(path.join(bucketRoot, "a.jpg"), "a-new");
    writeFileSync(paths.journalFile, "{truncated");

    expect(settleInterruptedCommit(paths)).toBe("rolled-back");
    expect(read("a.jpg")).toBe("a-old");
    expect(existsSync(paths.versionsFile)).toBe(false);
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
