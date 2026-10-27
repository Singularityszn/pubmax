import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RUNNER = join(process.cwd(), "scripts/e2e/run-disposable-plan-auth.mjs");
const CANARY = "fake_secret_canary_never_emit_97f8";
const KNOWN_MIGRATION = "20260101000000_fixture.sql";
const FIXTURE_SQL = "-- benign committed fixture\n";
const OWNED_HOST = `unix://${join(homedir(), ".colima/account-auth-recovery-1026/docker.sock")}`;
const DIAGNOSTIC_PREFIX = "Supabase startup diagnostic: ";
const GUARD_REFUSAL = "Disposable auth requires its owned Docker socket without context or TLS overrides.";

type Diagnostic = {
  causes: string[];
  nativeCodes?: string[];
  stages?: string[];
  lastStartedMigration?: string;
  sqlstateToken?: string;
  exit: number | null;
  signal: string | null;
  stdoutBytes: number;
  stderrBytes: number;
  truncated: boolean;
};

type SparseChildEnv = Record<string, string | undefined>;

/** Real runner and real subprocess pipes, with no executable daemon on PATH. */
function runFixture(input: {
  message?: string;
  stream?: "stdout" | "stderr";
  split?: boolean;
  late?: boolean;
  signal?: boolean;
  earlyCause?: boolean;
  interleave?: boolean;
  migrationMismatch?: boolean;
  migrationMixed?: boolean;
  statusMode?: "failure" | "invalid-url" | "inspect-failure";
  overrides?: SparseChildEnv;
}) {
  const root = mkdtempSync(join(tmpdir(), "pubmax-auth-diagnostic-"));
  const bin = join(root, "bin");
  const temp = join(root, "temp");
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  mkdirSync(bin);
  mkdirSync(temp);
  mkdirSync(join(root, "scripts/e2e"), { recursive: true });
  mkdirSync(join(root, "supabase/migrations"), { recursive: true });
  writeFileSync(join(root, "supabase/migrations", KNOWN_MIGRATION), input.migrationMismatch ? FIXTURE_SQL + "-- changed\n" : FIXTURE_SQL);
  // A fail-only import boundary, not an auth implementation or HTTP endpoint.
  // Older runners must fail this explicit oracle rather than a missing-package setup error.
  const authGuard = join(root, "node_modules/@supabase/supabase-js");
  mkdirSync(authGuard, { recursive: true });
  writeFileSync(join(authGuard, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
  writeFileSync(join(authGuard, "index.js"), 'throw new Error("AUTH_FIXTURE_FORBIDDEN_AUTH_BOUNDARY");\n');
  copyFileSync(RUNNER, join(root, "scripts/e2e/run-disposable-plan-auth.mjs"));
  const fixtureConfig = ['project_id = "fixture"', "[api]", "port = 54321", "[db]", "port = 54322", "shadow_port = 54320", "major_version = 17", "[db.seed]", "enabled = true",
    ...["studio", "local_smtp", "realtime", "storage", "edge_runtime", "analytics"].flatMap((name) => [`[${name}]`, "enabled = true"])].join("\n");
  const common = `import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
let realtimeSetup = null;
let realtimeServerExcluded = null;
if (process.argv[1].endsWith("/supabase") && process.argv[2] === "start") {
  const generatedConfig = readFileSync(join(process.argv[process.argv.indexOf("--workdir") + 1], "supabase/config.toml"), "utf8");
  const block = generatedConfig.split("[realtime]")[1]?.split("\\n[")[0] ?? "";
  realtimeSetup = /^enabled = true$/m.test(block);
  realtimeServerExcluded = process.argv[process.argv.indexOf("--exclude") + 1]?.split(",").includes("realtime") === true;
}
appendFileSync(process.env.AUTH_FIXTURE_MARKER, JSON.stringify({ jsonErrors: process.argv.includes("--output-format") && process.argv.includes("json"), realtimeSetup, realtimeServerExcluded, program: process.argv[1].split("/").at(-1), action: process.argv[2], structured: process.argv.includes("--output-format") && process.argv.includes("stream-json"), ownedHost: process.env.DOCKER_HOST === process.env.AUTH_FIXTURE_OWNED_HOST }) + "\\n");
`;
  const blob = createHash("sha1").update(`blob ${Buffer.byteLength(FIXTURE_SQL)}\0`).update(FIXTURE_SQL).digest("hex");
  const git = `#!${process.execPath}\n${common}if (process.argv[2] !== "ls-tree") process.exit(92); else process.stdout.write(${JSON.stringify(`100644 blob ${blob}\tsupabase/migrations/${KNOWN_MIGRATION}\0`)});`;
  const docker = `#!${process.execPath}\n${common}
if (process.env.AUTH_FIXTURE_STATUS_MODE === "inspect-failure" && process.argv[2] !== "info") {
  const ownedDir = readdirSync(process.env.TMPDIR).find((name) => name.startsWith("pubmax-auth-"));
  const generated = readFileSync(join(process.env.TMPDIR, ownedDir, "supabase/config.toml"), "utf8");
  const project = generated.match(/^project_id = "([^\\"]+)"/m)[1];
  if (process.argv[2] === "ps") process.stdout.write(["1", "2", "3", "4"].map((value) => value.repeat(64)).join("\\n") + "\\n");
  else if (process.argv[2] === "inspect" && process.argv.includes("{{json .Config.Labels}}")) {
    process.stdout.write(JSON.stringify({ "com.supabase.cli.project": project }));
  } else if (process.argv[2] === "inspect") {
    process.stderr.write('template parsing error: map has no entry for key "Health" ' + process.env.AUTH_FIXTURE_CANARY);
    process.exitCode = 24;
  } else if (process.argv[2] !== "stop") process.exitCode = 90;
} else if (process.argv[2] !== "info") process.exitCode = 90;
`;

  const supabase = `#!${process.execPath}\n${common}
const action = process.argv[2];
const workdir = process.argv[process.argv.indexOf("--workdir") + 1];
if (action === "init") {
  mkdirSync(join(workdir, "supabase"), { recursive: true });
  writeFileSync(join(workdir, "supabase/config.toml"), ${JSON.stringify(fixtureConfig)});
} else if (action === "status") {
  if (process.env.AUTH_FIXTURE_STATUS_MODE === "failure") {
    process.stdout.write(JSON.stringify({ _tag: "Error", error: { code: "StatusDbNotReadyError", message: process.env.AUTH_FIXTURE_CANARY, detail: process.env.AUTH_FIXTURE_CANARY }, context: process.env.AUTH_FIXTURE_CANARY }));
    process.exitCode = 23;
  } else process.stdout.write(JSON.stringify({ API_URL: process.env.AUTH_FIXTURE_STATUS_MODE === "inspect-failure" ? "http://127.0.0.1:54321" : "https://example.test", ANON_KEY: process.env.AUTH_FIXTURE_CANARY, SERVICE_ROLE_KEY: process.env.AUTH_FIXTURE_CANARY }));
} else if (action === "migration") {
  if (process.env.AUTH_FIXTURE_STATUS_MODE === "") process.exitCode = 93;
} else if (action === "start" && process.env.AUTH_FIXTURE_STATUS_MODE !== "") {
  // Successful CLI setup only. No fake session or authentication response exists.
} else if (action === "start") {
  const output = process.env.AUTH_FIXTURE_STREAM === "stdout" ? process.stdout : process.stderr;
  const write = (value) => new Promise((resolve) => output.write(value, resolve));
  // Drain far beyond the retention window before the actual late failure.
  if (process.env.AUTH_FIXTURE_EARLY_CAUSE === "1") await write("failed to pull early image\\n");
  if (process.env.AUTH_FIXTURE_LATE === "1") {
    for (let index = 0; index < 40; index += 1) {
      await new Promise((resolve) => process.stdout.write(process.env.AUTH_FIXTURE_CANARY.repeat(256) + "\\n", resolve));
      await new Promise((resolve) => process.stderr.write(process.env.AUTH_FIXTURE_CANARY.repeat(256) + "\\n", resolve));
    }
  }
  await write(process.env.AUTH_FIXTURE_CANARY + "\\n");
  const message = process.env.AUTH_FIXTURE_MESSAGE;
  if (process.env.AUTH_FIXTURE_MIGRATION_MIXED === "1") {
    await new Promise((resolve) => process.stdout.write("Applying migration " + ${JSON.stringify(KNOWN_MIGRATION)} + "...\\n", resolve));
    await new Promise((resolve) => process.stderr.write(message, resolve));
  } else if (process.env.AUTH_FIXTURE_INTERLEAVE === "1") {
    // Backpressure forces the parent to drain each large write. No sleep or retry.
    await new Promise((resolve) => process.stderr.write(process.env.AUTH_FIXTURE_CANARY.repeat(8192) + "\\naddress already", resolve));
    await new Promise((resolve) => process.stdout.write(process.env.AUTH_FIXTURE_CANARY.repeat(32768) + "\\n", resolve));
    await new Promise((resolve) => process.stderr.write(" in use\\n", resolve));
  } else if (process.env.AUTH_FIXTURE_SPLIT === "1") {
    const middle = Math.floor(message.length / 2);
    await write(message.slice(0, middle));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await write(message.slice(middle));
  } else await write(message);
  if (process.env.AUTH_FIXTURE_SIGNAL === "1") process.kill(process.pid, "SIGTERM");
  else process.exitCode = 23;
} else if (action !== "stop") process.exitCode = 91;
`;
  for (const [name, content] of [["docker", docker], ["supabase", supabase], ["git", git]]) {
    writeFileSync(join(bin, name!), content!);
    chmodSync(join(bin, name!), 0o700);
  }
  const inputs = [join(root, "package.json"), join(root, "scripts/e2e/run-disposable-plan-auth.mjs"),
    join(bin, "docker"), join(bin, "supabase"), join(bin, "git"), join(root, "supabase/migrations", KNOWN_MIGRATION), join(authGuard, "package.json"), join(authGuard, "index.js")].map((path) => ({ path, bytes: readFileSync(path) }));
  try {
    // Node accepts sparse child dictionaries. Next requires NODE_ENV for the app process.
    // Check the dictionary, then assert only this child-process boundary value.
    const env = {
      // Preserve actual HOME. PATH contains ONLY fixture Docker, Supabase and Git executables.
      HOME: homedir(), PATH: bin, TMPDIR: temp, LANG: "C", LC_ALL: "C",
      NODE_OPTIONS: "--max-old-space-size=256", DOCKER_HOST: OWNED_HOST,
      AUTH_FIXTURE_MARKER: join(root, "spawn-marker.jsonl"), AUTH_FIXTURE_OWNED_HOST: OWNED_HOST,
      AUTH_FIXTURE_CANARY: CANARY, AUTH_FIXTURE_MESSAGE: input.message ?? "Unfamiliar startup refusal",
      AUTH_FIXTURE_STREAM: input.stream ?? "stderr", AUTH_FIXTURE_LATE: input.late ? "1" : "0",
      AUTH_FIXTURE_SPLIT: input.split ? "1" : "0", AUTH_FIXTURE_SIGNAL: input.signal ? "1" : "0",
      AUTH_FIXTURE_EARLY_CAUSE: input.earlyCause ? "1" : "0",
      AUTH_FIXTURE_INTERLEAVE: input.interleave ? "1" : "0",
      AUTH_FIXTURE_MIGRATION_MIXED: input.migrationMixed ? "1" : "0",
      AUTH_FIXTURE_STATUS_MODE: input.statusMode ?? "",
      ...input.overrides,
    } satisfies SparseChildEnv as unknown as NodeJS.ProcessEnv;
    const result = spawnSync(process.execPath, [join(root, "scripts/e2e/run-disposable-plan-auth.mjs"), "--staged"], {
      cwd: root, env, encoding: "utf8", timeout: 20_000, maxBuffer: 256 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    const output = result.stdout + result.stderr;
    expect(output).not.toContain(CANARY);
    const marker = join(root, "spawn-marker.jsonl");
    const spawns = existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
    const line = result.stderr.split("\n").find((item) => item.startsWith(DIAGNOSTIC_PREFIX));
    const diagnostic = line ? JSON.parse(line.slice(DIAGNOSTIC_PREFIX.length)) as Diagnostic : null;
    const statusLine = result.stderr.split("\n").find((item) => item.startsWith("Supabase status diagnostic: "));
    const statusDiagnostic = statusLine ? JSON.parse(statusLine.slice("Supabase status diagnostic: ".length)) : null;
    const inspectLine = result.stderr.split("\n").find((item) => item.startsWith("Owned Docker inspection diagnostic: "));
    const inspectionDiagnostic = inspectLine ? JSON.parse(inspectLine.slice("Owned Docker inspection diagnostic: ".length)) : null;
    return { status: result.status, output, diagnostic, statusDiagnostic, inspectionDiagnostic, spawns };
  } finally {
    try {
      // End-of-run evidence only: this cannot detect transient deleted writes.
      // Scan every owned file, including child TMPDIR, with no path exclusions.
      const scan = (directory: string): void => {
        for (const name of readdirSync(directory)) {
          const path = join(directory, name);
          const stat = lstatSync(path);
          expect(stat.isSymbolicLink(), `Unexpected link inside owned fixture: ${path}`).toBe(false);
          if (stat.isDirectory()) scan(path);
          else if (stat.isFile()) {
            expect(readFileSync(path).includes(Buffer.from(CANARY)), `Canary in owned file: ${path}`).toBe(false);
          }
        }
      };
      scan(root);
      // Fixture inputs do not contain the canary and are not excluded. Also
      // prove that the payload did not rewrite them to hide a captured output.
      for (const input of inputs) {
        expect(Buffer.compare(readFileSync(input.path), input.bytes), `Fixture input changed: ${input.path}`).toBe(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

const CAUSES = [
  ["daemon_unreachable", "Cannot connect to the Docker daemon"],
  ["image_pull_failure", "failed to pull image"],
  ["database_health_failure", "database health check failed"],
  ["migration_failure", "migration failed"],
  ["permission_failure", "permission denied"],
  ["port_bind_failure", "address already in use"],
  ["disk_full", "no space left on device"],
  ["out_of_memory", "out of memory"],
] as const;

describe("disposable auth startup diagnostic subprocess boundary", () => {
  for (const stream of ["stdout", "stderr"] as const) {
    it.each(CAUSES)(`classifies %s from ${stream} without emitting captured text`, (cause, message) => {
      const result = runFixture({ stream, message });
      expect(result.status).toBe(1);
      expect(result.diagnostic).toEqual({ causes: [cause], exit: 23, signal: null,
        stdoutBytes: stream === "stdout" ? Buffer.byteLength(CANARY + "\n" + message) : 0,
        stderrBytes: stream === "stderr" ? Buffer.byteLength(CANARY + "\n" + message) : 0,
        truncated: false });
      expect(result.output).not.toContain(message);
      expect(result.spawns.filter(({ program }) => program !== "git").map(({ program, action }) => `${program}:${action}`))
        .toEqual(["docker:info", "supabase:init", "supabase:start", "supabase:stop"]);
      expect(result.spawns.every(({ ownedHost }) => ownedHost === true)).toBe(true);
      expect(result.output).toContain('Docker custody: {"ownedHostMatched":true,"conflictingOverrides":false}');
    });

    it(`retains a late split failure on ${stream} after more than 256KiB from both pipes`, () => {
      const result = runFixture({ stream, message: "address already in use", late: true, split: true });
      expect(result.status).toBe(1);
      expect(result.diagnostic?.causes).toEqual(["port_bind_failure"]);
      expect(result.diagnostic?.stdoutBytes).toBeGreaterThan(256 * 1024);
      expect(result.diagnostic?.stderrBytes).toBeGreaterThan(256 * 1024);
      expect(result.diagnostic?.truncated).toBe(true);
    });
  }

  for (const stream of ["stdout", "stderr"] as const) {
    it(`reads a split structured failure mixed with raw text from ${stream}`, () => {
      const message = "Starting database...\nInitialising schema...\n" + JSON.stringify({
        type: "error", error: { code: "MigrationApplyError", message: CANARY, detail: CANARY, suggestion: CANARY },
        timestamp: CANARY, context: { credential: CANARY },
      }) + "\n";
      const result = runFixture({ stream, message, split: true, late: true });
      expect(result.status).toBe(1);
      expect(result.diagnostic?.nativeCodes).toEqual(["MigrationApplyError"]);
      expect(result.diagnostic?.stages).toEqual(["database_start", "schema_init"]);
      expect(result.diagnostic?.truncated).toBe(true);
      expect(result.spawns.find(({ action }) => action === "start")?.structured).toBe(true);
    });
  }

  it.each([
    { type: "error", error: { code: CANARY, message: CANARY } },
    { type: "result", data: { code: "DbSetupError", password: CANARY } },
    { type: "log", message: CANARY, error: { code: "DbSetupError" } },
    { type: "error", error: { code: ["DbSetupError"], message: CANARY } },
  ])("discards untrusted structured fields without accepting an uncontrolled code %#", (event) => {
    const result = runFixture({ message: JSON.stringify(event) + "\n" });
    expect(result.diagnostic?.nativeCodes).toBeUndefined();
    expect(result.diagnostic?.stages).toBeUndefined();
    expect(result.diagnostic?.causes).toEqual(["unknown"]);
  });

  it("discards malformed and oversized lines but reads the next bounded event", () => {
    const message = '{"type":"error",broken\n' + JSON.stringify({ type: "error", error: {
      code: "DbSetupError", message: CANARY.repeat(3000),
    } }) + "\n" + JSON.stringify({ type: "error", error: { code: "StartInvalidConfigError", message: CANARY } }) + "\n";
    const result = runFixture({ message, split: true });
    expect(result.diagnostic?.nativeCodes).toEqual(["StartInvalidConfigError"]);
    expect(result.diagnostic?.truncated).toBe(true);
  });

  it("keeps a stderr cause intact across backpressured stdout noise", () => {
    const result = runFixture({ interleave: true });
    expect(result.status).toBe(1);
    expect(result.diagnostic?.causes).toEqual(["port_bind_failure"]);
    expect(result.diagnostic?.stdoutBytes).toBeGreaterThan(256 * 1024);
    expect(result.diagnostic?.stderrBytes).toBeGreaterThan(256 * 1024);
    expect(result.diagnostic?.truncated).toBe(true);
  });

  for (const stream of ["stdout", "stderr"] as const) {
    it(`extracts only admitted migration context and SQLSTATE from split ${stream}`, () => {
      const message = `Applying migration ${KNOWN_MIGRATION}...\n` + JSON.stringify({ type: "error", error: {
        code: "MigrationApplyError", message: `ERROR: ${CANARY} (SQLSTATE 42P01)\n${CANARY}`,
        detail: CANARY, position: CANARY,
      }, context: CANARY }) + "\n";
      const result = runFixture({ message, stream, split: true });
      expect(result.diagnostic?.lastStartedMigration).toBe(KNOWN_MIGRATION);
      expect(result.diagnostic?.sqlstateToken).toBe("42P01");
    });
  }

  it.each(["20260101000000_unknown.sql", "../" + KNOWN_MIGRATION, CANARY + ".sql"])(
    "rejects a non-admitted migration marker %#", (name) => {
      const result = runFixture({ message: `Applying migration ${name}...\n` });
      expect(result.diagnostic?.lastStartedMigration).toBeUndefined();
    });

  it.each(["42p01", "42P0", "42P010", "42-P1", CANARY])("rejects a malformed SQLSTATE token %#", (token) => {
    const result = runFixture({ message: JSON.stringify({ type: "error", error: {
      code: "MigrationApplyError", message: `ERROR: private (SQLSTATE ${token})`,
    } }) + "\n" });
    expect(result.diagnostic?.sqlstateToken).toBeUndefined();
  });

  it("does not extract a SQLSTATE from another error class or private detail", () => {
    const result = runFixture({ message: JSON.stringify({ type: "error", error: {
      code: "DbSetupError", message: "ERROR: private (SQLSTATE 42P01)", detail: CANARY,
    } }) + "\n" });
    expect(result.diagnostic?.sqlstateToken).toBeUndefined();
  });

  it("refuses changed migration bytes before starting Supabase", () => {
    const result = runFixture({ migrationMismatch: true });
    expect(result.output).toContain("Disposable migration inventory differs from its committed source.");
    expect(result.spawns.some(({ action }) => action === "start")).toBe(false);
    expect(result.diagnostic).toBeNull();
  });

  it("combines admitted progress and error context from separate pipes", () => {
    const result = runFixture({ migrationMixed: true, message: JSON.stringify({ type: "error", error: {
      code: "MigrationApplyError", message: `ERROR: ${CANARY} (SQLSTATE 42501)`,
    } }) + "\n" });
    expect(result.diagnostic?.lastStartedMigration).toBe(KNOWN_MIGRATION);
    expect(result.diagnostic?.sqlstateToken).toBe("42501");
  });

  it("enables real Realtime schema setup while excluding the persistent server", () => {
    const result = runFixture({});
    expect(result.status).toBe(1);
    const start = result.spawns.find(({ program, action }) => program === "supabase" && action === "start");
    expect(start?.realtimeSetup).toBe(true);
    expect(start?.realtimeServerExcluded).toBe(true);
  });

  it("reports only the allowlisted native status failure after successful CLI setup", () => {
    const result = runFixture({ statusMode: "failure" });
    expect(result.status).toBe(1);
    expect(result.statusDiagnostic).toMatchObject({ nativeCode: "StatusDbNotReadyError", exit: 23, signal: null, truncated: false });
    expect(result.spawns.filter(({ program }) => program === "supabase").map(({ action }) => action))
      .toEqual(["init", "start", "migration", "status", "stop"]);
    expect(result.spawns.find(({ action }) => action === "status")?.jsonErrors).toBe(true);
    expect(result.output).not.toContain("context");
  });

  it("keeps successful raw status credentials private through the existing invalid-URL guard", () => {
    const result = runFixture({ statusMode: "invalid-url" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Disposable Supabase status is incomplete.");
    expect(result.statusDiagnostic).toBeNull();
    expect(result.output).not.toContain("https://example.test");
    expect(result.output).not.toContain("Node GoTrue bootstrap proof");
  });

  it("classifies an early owned formatter failure before GoTrue or a build", () => {
    const result = runFixture({ statusMode: "inspect-failure" });
    expect(result.status).toBe(1);
    expect(result.output).not.toContain("AUTH_FIXTURE_FORBIDDEN_AUTH_BOUNDARY");
    expect(result.inspectionDiagnostic).toMatchObject({ kind: "missing_health_key", exit: 24, signal: null });
    expect(result.spawns.filter(({ action }) => action === "inspect")).toHaveLength(5);
    expect(result.output).not.toContain("Node GoTrue bootstrap proof");
    expect(result.output).not.toContain("Stage ready:");
    expect(result.output).not.toContain("template parsing error");
    expect(result.output).not.toContain("http://127.0.0.1:54321");
  });

  it("keeps unmatched failures unknown without leaking their text", () => {
    const result = runFixture({ message: "Unfamiliar startup refusal" });
    expect(result.status).toBe(1);
    expect(result.diagnostic?.causes).toEqual(["unknown"]);
    expect(result.output).not.toContain("Unfamiliar startup refusal");
  });

  it("does not claim a cause that aged out of the bounded tail", () => {
    const result = runFixture({ late: true, earlyCause: true });
    expect(result.status).toBe(1);
    expect(result.diagnostic?.causes).toEqual(["unknown"]);
    expect(result.diagnostic?.truncated).toBe(true);
  });

  it("reports a startup signal without pretending it was a numeric exit", () => {
    const result = runFixture({ signal: true });
    expect(result.status).toBe(1);
    expect(result.diagnostic).toMatchObject({ causes: ["unknown"], exit: null, signal: "SIGTERM" });
  });

  it.each([
    ["DOCKER_HOST", "unix:///foreign-docker.sock"],
    ["DOCKER_CONTEXT", "foreign-context"],
    ["DOCKER_TLS", "1"],
    ["DOCKER_TLS_VERIFY", "1"],
    ["DOCKER_CERT_PATH", "/foreign-certificates"],
  ])("refuses %s before any Docker/Supabase executable starts", (name, value) => {
    const result = runFixture({ overrides: { [name]: value } });
    expect(result.status).toBe(1);
    expect(result.output.trim()).toBe(GUARD_REFUSAL);
    expect(result.spawns).toEqual([]);
    expect(result.diagnostic).toBeNull();
    expect(result.output).not.toContain(value);
  });
});
