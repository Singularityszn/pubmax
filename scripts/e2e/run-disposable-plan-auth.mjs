/** Run real cookie-loss recovery against a new local Supabase project. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const staged = process.argv.slice(2).includes("--staged");
if (process.argv.slice(2).some((argument) => argument !== "--staged")) {
  throw new Error("Usage: node scripts/e2e/run-disposable-plan-auth.mjs [--staged]");
}
const projectId = `pubmax-auth-${randomBytes(6).toString("hex")}`;
const workdir = mkdtempSync(join(tmpdir(), `${projectId}-`));
const dist = `.next-${projectId}`;
let started = false;
let child;
let interrupted = false;
let stageInput;
let rejectStage;
let ownedContainers = [];
const admittedMigrations = new Set();
const processGroups = new Set();

async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}

async function command(program, args, { capture = false, env = process.env, cleanup = false, timeoutMs } = {}) {
  if (interrupted && !cleanup) throw new Error("Disposable Plan auth interrupted.");
  if (program === "docker" || program === "supabase") {
    const ownedHost = `unix://${join(homedir(), ".colima/account-auth-recovery-1026/docker.sock")}`;
    if (env.DOCKER_HOST !== ownedHost || env.DOCKER_CONTEXT?.trim()
      || env.DOCKER_TLS?.trim() || env.DOCKER_TLS_VERIFY?.trim() || env.DOCKER_CERT_PATH?.trim()) {
      throw new Error("Disposable auth requires its owned Docker socket without context or TLS overrides.");
    }
    console.log("Docker custody: " + JSON.stringify({ ownedHostMatched: true, conflictingOverrides: false }));
  }
  const startup = capture && program === "supabase" && args[0] === "start";
  const statusCapture = capture && program === "supabase" && args[0] === "status";
  const inspectionCapture = capture && program === "docker" && args[0] === "inspect" && timeoutMs !== undefined;
  return new Promise((resolve, reject) => {
    const processChild = spawn(program, args, { cwd: ROOT, env, detached: true, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    child = processChild;
    if (processChild.pid) processGroups.add(processChild.pid);
    let timedOut = false;
    const commandTimer = timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      if (processChild.pid) signalGroup(processChild.pid, "SIGTERM");
      // The existing finally cleanup owns any descendant that outlives SIGTERM.
      reject(new Error("Owned backend readiness inspection deadline expired."));
    }, timeoutMs);
    let output = "";
    const tails = [Buffer.alloc(0), Buffer.alloc(0)];
    let inspectionTail = Buffer.alloc(0);
    let stdoutBytes = 0;
    let stderrBytes = 0;
    // Native Supabase 2.122 tags only. Messages and machine context stay private.
    const allowedCodes = new Set([
      "StartWorkdirError", "StartConfigLoadError", "StartInvalidConfigError", "StartSnippetsDirectoryError",
      "DbSetupError", "MigrationApplyError", "DbConnectError", "DbExecError", "HealthCheckTimeoutError",
    ]);
    const stageNames = new Map([
      ["Starting database...", "database_start"],
      ["Starting database from backup...", "database_restore"],
      ["Initialising schema...", "schema_init"],
      ["Starting containers...", "containers_start"],
      ["Waiting for health checks...", "health_wait"],
    ]);
    let lastStartedMigration;
    let sqlstateToken;
    const nativeCodes = new Set();
    const stages = new Set();
    const lines = [{ pending: Buffer.alloc(0), dropping: false }, { pending: Buffer.alloc(0), dropping: false }];
    const parseLine = (bytes) => {
      const line = bytes.toString("utf8").replace(/\r$/, "");
      const stage = stageNames.get(line);
      if (stage) stages.add(stage);
      const migration = /^Applying migration ([0-9]{14}_[a-z0-9_]+\.sql)\.\.\.$/.exec(line)?.[1];
      if (migration && admittedMigrations.has(migration)) lastStartedMigration = migration;
      try {
        const event = JSON.parse(line);
        if (event?.type === "error" && typeof event.error?.code === "string"
          && allowedCodes.has(event.error.code)) {
          nativeCodes.add(event.error.code);
          if (event.error.code === "MigrationApplyError" && typeof event.error.message === "string") {
            // Only the source-rendered first-line token survives. No private text leaves memory.
            const firstLine = event.error.message.split(/\r?\n/, 1)[0];
            sqlstateToken = /^[A-Z]+: [^\r\n]* \(SQLSTATE ([A-Z0-9]{5})\)$/.exec(firstLine)?.[1];
          }
        }
      } catch { /* Mixed raw output is expected. Never forward it. */ }
    };
    const readStartupLines = (bytes, stderr) => {
      const state = lines[stderr ? 1 : 0];
      let begin = 0;
      while (begin < bytes.length) {
        const newline = bytes.indexOf(10, begin);
        const end = newline < 0 ? bytes.length : newline;
        const part = bytes.subarray(begin, end);
        if (!state.dropping) {
          if (state.pending.length + part.length > 64 * 1024) {
            state.pending = Buffer.alloc(0);
            state.dropping = true;
          } else state.pending = Buffer.concat([state.pending, part]);
        }
        if (newline < 0) break;
        if (!state.dropping) parseLine(state.pending);
        state.pending = Buffer.alloc(0);
        state.dropping = false;
        begin = newline + 1;
      }
    };
    const retainStartupTail = (chunk, stderr) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stderr) stderrBytes += bytes.length;
      else stdoutBytes += bytes.length;
      readStartupLines(bytes, stderr);
      // Keep each pipe separate within a total 64 KiB raw-tail budget.
      // Both streams always drain. No raw tail is printed or persisted.
      const index = stderr ? 1 : 0;
      tails[index] = Buffer.from(Buffer.concat([tails[index], bytes]).subarray(-32 * 1024));
    };
    if (capture) processChild.stdout.on("data", (chunk) => {
      if (startup) retainStartupTail(chunk, false);
      else if (statusCapture || inspectionCapture) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stdoutBytes += bytes.length;
        output += bytes.subarray(0, Math.max(0, (inspectionCapture ? 4096 : 64 * 1024) - Buffer.byteLength(output))).toString("utf8");
      } else output += chunk;
    });
    if (capture) {
      if (startup) processChild.stderr.on("data", (chunk) => retainStartupTail(chunk, true));
      else if (statusCapture || inspectionCapture) processChild.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (inspectionCapture) inspectionTail = Buffer.from(Buffer.concat([inspectionTail, chunk]).subarray(-8192));
      });
      else processChild.stderr.resume();
    }
    processChild.once("error", (error) => {
      clearTimeout(commandTimer);
      reject(error);
    });
    processChild.once("close", (code, signal) => {
      clearTimeout(commandTimer);
      child = null;
      if (timedOut) return;

      if (interrupted && !cleanup) reject(new Error("Disposable Plan auth interrupted."));
      else if (inspectionCapture && code !== 0) {
        const privateText = inspectionTail.toString("utf8");
        const kind = privateText.includes('map has no entry for key "Health"') ? "missing_health_key"
          : privateText.includes("template parsing error:") ? "template_error" : "unknown";
        reject(new Error("Owned Docker inspection diagnostic: " + JSON.stringify({
          kind, exit: code, signal, stdoutBytes, stderrBytes, truncated: stderrBytes > inspectionTail.length || stdoutBytes > 4096,
        })));
      } else if (statusCapture) {
        const allowed = new Set(["StatusDbInspectError", "StatusDbNotRunningError", "StatusDbNotReadyError", "StatusListError",
          "StatusConfigLoadError", "StatusInvalidConfigError", "StatusWorkdirError", "StatusOverrideParseError"]);
        let parsed;
        try { parsed = JSON.parse(output); } catch { /* Never expose malformed private JSON. */ }
        if (code === 0 && parsed && stdoutBytes <= 64 * 1024) resolve(output);
        else reject(new Error("Supabase status diagnostic: " + JSON.stringify({
          nativeCode: parsed?._tag === "Error" && allowed.has(parsed.error?.code) ? parsed.error.code : "unknown",
          exit: code, signal, stdoutBytes, stderrBytes, truncated: stdoutBytes > 64 * 1024,
        })));
      } else if (code === 0) resolve(output);
      else if (startup) {
        const texts = tails.map((tail) => tail.toString("utf8"));
        const patterns = [
          ["daemon_unreachable", /cannot connect to (?:the )?docker daemon|docker daemon is not running|dial unix[^\n]*no such file/i],
          ["image_pull_failure", /failed to pull|pull access denied|manifest unknown|toomanyrequests|failed to resolve reference/i],
          ["database_health_failure", /(?:database|postgres|supabase_db)[^\n]*(?:unhealthy|health check failed)|database is not ready/i],
          ["migration_failure", /migration[^\n]*(?:failed|error)|failed to apply[^\n]*migration/i],
          ["permission_failure", /permission denied|operation not permitted/i],
          ["port_bind_failure", /address already in use|port is already allocated|ports are not available/i],
          ["disk_full", /no space left on device/i],
          ["out_of_memory", /out of memory|oom-kill|oom killer/i],
        ];
        const causes = patterns.filter(([, pattern]) => texts.some((text) => pattern.test(text))).map(([name]) => name);
        reject(new Error("Supabase startup diagnostic: " + JSON.stringify({
          causes: causes.length ? causes : ["unknown"], exit: code, signal,
          ...(lastStartedMigration ? { lastStartedMigration } : {}),
          ...(sqlstateToken ? { sqlstateToken } : {}),
          ...(nativeCodes.size ? { nativeCodes: [...nativeCodes] } : {}),
          ...(stages.size ? { stages: [...stages] } : {}),
          stdoutBytes, stderrBytes, truncated: stdoutBytes + stderrBytes > tails[0].length + tails[1].length,
        })));
      } else reject(new Error(`${program} ${args[0]} failed (${signal ?? code}).`));
    });
  });
}

function configure(source, section, key, value) {
  const heading = `[${section}]`;
  const begin = source.indexOf(heading);
  if (begin < 0) throw new Error(`Supabase init omitted ${heading}.`);
  const next = source.indexOf("\n[", begin + heading.length);
  const end = next < 0 ? source.length : next;
  const block = source.slice(begin, end);
  const pattern = new RegExp(`^${key} = .*`, "m");
  if (!pattern.test(block)) throw new Error(`Supabase init omitted ${section}.${key}.`);
  return source.slice(0, begin) + block.replace(pattern, `${key} = ${value}`) + source.slice(end);
}

function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

async function stopProcessGroups() {
  for (const pid of processGroups) signalGroup(pid, "SIGTERM");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    for (const pid of processGroups) {
      try { process.kill(-pid, 0); }
      catch (error) { if (error.code === "ESRCH") processGroups.delete(pid); else throw error; }
    }
    if (!processGroups.size) return;
    if (attempt === 20) for (const pid of processGroups) signalGroup(pid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Owned child processes remain. Build output was preserved.");
}

async function stageGate(name) {
  if (interrupted) throw new Error("Disposable Plan auth interrupted.");
  console.log(`Stage ready: ${name}. Await fresh coordinator admission, then enter ${name}.`);
  stageInput = createInterface({ input: process.stdin, terminal: false });
  try {
    await new Promise((resolve, reject) => {
      rejectStage = reject;
      stageInput.once("line", (line) => line.trim() === name ? resolve() : reject(new Error("Unexpected stage command.")));
      stageInput.once("close", () => reject(new Error("Stage input closed before admission.")));
    });
  } finally {
    rejectStage = undefined;
    stageInput.close();
    stageInput = undefined;
  }
}

/** Node-only proof. Browser login/refresh remains subject to production CSP. */
async function verifyBootstrapGoTrue(url, publicKey, serviceKey) {
  const { createClient } = await import("@supabase/supabase-js");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, serviceKey, options);
  const client = createClient(url, publicKey, options);
  const email = `plan-bootstrap-${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(32).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Disposable bootstrap user creation failed.");
  const userId = created.data.user.id;
  try {
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw new Error("Disposable bootstrap GoTrue sign-in failed.");
    const verified = await admin.auth.getUser(signedIn.data.session.access_token);
    if (verified.error || verified.data.user?.id !== userId) {
      throw new Error("Disposable bootstrap GoTrue session verification failed.");
    }
  } finally {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) throw new Error("Disposable bootstrap user cleanup failed.");
  }
  // No account id, email, password, session or project credential is recorded.
  console.log("Node GoTrue bootstrap proof: " + JSON.stringify({
    userCreated: true, passwordSignIn: true, getUserVerified: true, userDeleted: true,
  }));
}

async function waitForOwnedContainers() {
  // Use the same owned inspection before the first freeze and after restart.
  // Inspect only selected enums and exact retained IDs. No health logs or env.
  const containerDeadline = Date.now() + 60_000;
  let containersReady = false;
  while (!containersReady && Date.now() < containerDeadline && !interrupted) {
    containersReady = true;
    for (const id of ownedContainers) {
      const remainingMs = containerDeadline - Date.now();
      if (remainingMs <= 0) throw new Error("Owned backend readiness deadline expired.");
      const inspection = (await command("docker", ["inspect", "--format",
        '{{.Id}} {{index .Config.Labels "com.supabase.cli.project"}} {{.State.Running}} {{.State.Restarting}} {{.State.Status}} {{with index .State "Health"}}{{index . "Status"}}{{else}}none{{end}}', id], { capture: true, timeoutMs: remainingMs })).trim().split(/\s+/);
      if (Date.now() >= containerDeadline) throw new Error("Owned backend readiness deadline expired.");
      const [actualId, label, running, restarting, state, health] = inspection;
      if (inspection.length !== 6 || actualId !== id || label !== projectId
        || !["true", "false"].includes(running) || !["true", "false"].includes(restarting)
        || !["created", "running", "restarting"].includes(state)
        || !["none", "starting", "healthy", "unhealthy"].includes(health)) {
        throw new Error("Owned backend readiness identity or state is invalid.");
      }
      if (health === "unhealthy") throw new Error("Owned backend readiness reported unhealthy.");
      if (running !== "true" || restarting !== "false" || state !== "running" || health === "starting") containersReady = false;
    }
    if (!containersReady) await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(0, containerDeadline - Date.now()))));
  }
  if (!containersReady || Date.now() >= containerDeadline) throw new Error("Owned backend readiness deadline expired.");
  console.log("Owned backend readiness: " + JSON.stringify({ state: "ready", containerCount: ownedContainers.length }));
}

async function checkOwnedContainers() {
  for (const id of ownedContainers) {
    const labels = JSON.parse(await command("docker", ["inspect", "--format", "{{json .Config.Labels}}", id], { capture: true }));
    if (labels?.["com.supabase.cli.project"] !== projectId) throw new Error("Disposable container ownership changed.");
  }
}

const interrupt = () => {
  interrupted = true;
  process.exitCode = 130;
  rejectStage?.(new Error("Disposable Plan auth interrupted."));
  stageInput?.close();
  if (child?.pid) signalGroup(child.pid, "SIGTERM");
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  // This runner never starts a VM or selects a foreign Docker context.
  await command("docker", ["info"], { capture: true });
  await command("supabase", ["init", "--workdir", workdir], { capture: true });
  const configPath = join(workdir, "supabase/config.toml");
  let config = readFileSync(configPath, "utf8").replace(/^project_id = .*$/m, `project_id = "${projectId}"`);
  for (const [section, key, value] of [
    ["api", "port", await port()],
    ["db", "port", await port()],
    ["db", "shadow_port", await port()],
    ["db", "major_version", 17],
    ["db.seed", "enabled", false],
    ["studio", "enabled", false],
    ["local_smtp", "enabled", false],
    ["realtime", "enabled", true],
    ["storage", "enabled", false],
    ["edge_runtime", "enabled", false],
    ["analytics", "enabled", false],
  ]) config = configure(config, section, key, value);
  writeFileSync(configPath, config);
  // Admit direct forward migrations from HEAD, with Git blob identity checked
  // against the bytes being copied. Never trust arbitrary local filenames.
  const migrationTree = await command("git", ["ls-tree", "-rz", "HEAD", "--", "supabase/migrations"], { capture: true });
  for (const entry of migrationTree.split("\0").filter(Boolean)) {
    const match = /^100644 blob ([a-f0-9]{40})\tsupabase\/migrations\/([0-9]{14}_[a-z0-9_]+\.sql)$/.exec(entry);
    if (!match) continue; // Rollbacks below subdirectories are outside this inventory.
    const bytes = readFileSync(join(ROOT, "supabase/migrations", match[2]));
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (blob !== match[1]) throw new Error("Disposable migration inventory differs from its committed source.");
    admittedMigrations.add(match[2]);
  }
  if (!admittedMigrations.size) throw new Error("Disposable committed migration inventory is empty.");
  const localNames = readdirSync(join(ROOT, "supabase/migrations")).filter((name) => name.endsWith(".sql"));
  if (localNames.length !== admittedMigrations.size || localNames.some((name) => !admittedMigrations.has(name))) {
    throw new Error("Disposable migration inventory differs from its committed source.");
  }
  cpSync(join(ROOT, "supabase/migrations"), join(workdir, "supabase/migrations"), { recursive: true });
  // Mark ownership before start so a partial failure also receives cleanup.
  started = true;
  await command("supabase", ["start", "--output-format", "stream-json", "--workdir", workdir, "--exclude", "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"], { capture: true });
  await command("supabase", ["migration", "up", "--local", "--workdir", workdir], { capture: true });
  const status = JSON.parse(await command("supabase", ["status", "--workdir", workdir, "--output-format", "json", "--output", "json"], { capture: true }));
  const url = new URL(status.API_URL);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error("Disposable Supabase status is incomplete.");
  url.hostname = "127.0.0.1";
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL", "PLAYWRIGHT_BROWSERS_PATH"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // Next loads these files itself. Empty inherited entries stop dotenv from
  // reintroducing any account, provider or production setting from a checkout.
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match) env[match[1]] = "";
    }
  }
  Object.assign(env, {
    NODE_OPTIONS: "--max-old-space-size=4096",
    OPENROUTER_API_KEY: "", ELEVENLABS_API_KEY: "", AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "",
    PW_DISPOSABLE_PLAN_DB: "1", PW_DISPOSABLE_PLAN_AUTH: "1",
    PW_DISPOSABLE_PLAN_SIGNING_SECRET: randomBytes(32).toString("base64url"),
    PW_DISPOSABLE_SUPABASE_URL: url.origin,
    PW_DISPOSABLE_PUBLISHABLE_KEY: status.ANON_KEY,
    PW_DISPOSABLE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: url.origin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    PW_PORT: String(await port()), PW_SKIP_WEBSERVER: "0",
    PW_SKIP_KEYLESS_WEBSERVER: "1", PW_SCREENSHOTS: "", PUBMAX_E2E_LOGIN: "0",
    PW_NEXT_DIST_DIR: dist, PUBMAX_TRACKED_OUTPUTS: "public/data",
    ...(staged ? { PW_DISPOSABLE_AUTH_PREBUILT: "1" } : {}),
  });
  if (staged) {
    const ids = await command("docker", ["ps", "--all", "--quiet", "--no-trunc", "--filter", `label=com.supabase.cli.project=${projectId}`], { capture: true });
    ownedContainers = ids.trim().split(/\s+/).filter(Boolean);
    if (ownedContainers.length < 4) throw new Error("Disposable backend ownership inventory is incomplete.");
    await checkOwnedContainers();
    await waitForOwnedContainers();
    await verifyBootstrapGoTrue(url.origin, status.ANON_KEY, status.SERVICE_ROLE_KEY);
    const serverEnv = JSON.parse(await command(process.execPath, ["--import", "tsx", "scripts/print-e2e-server-env.ts"], { capture: true, env }));
    await command("docker", ["stop", ...ownedContainers], { capture: true });
    for (const id of ownedContainers) {
      const running = await command("docker", ["inspect", "--format", "{{.State.Running}}", id], { capture: true });
      if (running.trim() !== "false") throw new Error("Disposable backend did not stop.");
    }
    // Containers and volumes retain the genuine project identity and credentials.
    // Returning VM memory, when needed, remains the coordinator's operation.
    await stopProcessGroups();
    await stageGate("build");
    const publicConfigHash = createHash("sha256").update(JSON.stringify([url.origin, status.ANON_KEY])).digest("hex");
    const sourceHash = () => {
      const digest = createHash("sha256");
      for (const path of ["scripts/e2e/run-disposable-plan-auth.mjs", "playwright.config.ts", "e2e/helpers/realPlanAuth.ts", "e2e/plan-capability-recovery.spec.ts"]) {
        digest.update(path).update(readFileSync(join(ROOT, path)));
      }
      return digest.digest("hex");
    };
    const draftHash = sourceHash();
    const sourceHead = (await command("git", ["rev-parse", "HEAD"], { capture: true })).trim();
    await command(process.execPath, ["--max-old-space-size-percentage=6.25", "scripts/run-with-restored-next-env.mjs", "npm", "run", "build", "--", "--webpack"], {
      env: {
        ...env, ...serverEnv, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", PW_DISPOSABLE_SERVICE_ROLE_KEY: "",
        NODE_OPTIONS: "--max-old-space-size-percentage=6.25",
        CIRCLE_NODE_TOTAL: "2", RAYON_NUM_THREADS: "1", UV_THREADPOOL_SIZE: "1",
      },
    });
    await stopProcessGroups();
    const buildId = readFileSync(join(ROOT, dist, "BUILD_ID"), "utf8").trim();
    if (!buildId || sourceHash() !== draftHash || (await command("git", ["rev-parse", "HEAD"], { capture: true })).trim() !== sourceHead) throw new Error("Auth draft changed during the staged build.");
    const receiptPath = join(ROOT, "artifacts", `${projectId}-staging.json`);
    mkdirSync(join(ROOT, "artifacts"), { recursive: true });
    writeFileSync(receiptPath, JSON.stringify({ projectId, sourceHead, draftHash, publicConfigHash, buildId, stage: "build_completed_runtime_pending" }, null, 2), { mode: 0o600 });
    console.log(`Build receipt: ${receiptPath}`);
    await stageGate("test");
    if (sourceHash() !== draftHash || (await command("git", ["rev-parse", "HEAD"], { capture: true })).trim() !== sourceHead || readFileSync(join(ROOT, dist, "BUILD_ID"), "utf8").trim() !== buildId) {
      throw new Error("Staged source or build identity changed.");
    }
    await checkOwnedContainers();
    await command("docker", ["start", ...ownedContainers], { capture: true });
    await waitForOwnedContainers();
    const resumed = JSON.parse(await command("supabase", ["status", "--workdir", workdir, "--output-format", "json", "--output", "json"], { capture: true }));
    if (resumed.API_URL !== status.API_URL || resumed.ANON_KEY !== status.ANON_KEY || resumed.SERVICE_ROLE_KEY !== status.SERVICE_ROLE_KEY) {
      throw new Error("Disposable backend identity changed after the build.");
    }
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (!ready && Date.now() < deadline && !interrupted) {
      try {
        const health = await fetch(`${url.origin}/auth/v1/health`, { headers: { apikey: status.ANON_KEY }, signal: AbortSignal.timeout(2_000) });
        const rest = await fetch(`${url.origin}/rest/v1/plans?select=id&limit=0`, {
          headers: { apikey: status.ANON_KEY, authorization: `Bearer ${status.SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(2_000),
        });
        ready = health.ok && rest.ok;
      } catch { /* The same containers may still be starting. */ }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("The original disposable auth backend did not become ready.");
  }
  await command(process.execPath, [...(staged ? ["--max-old-space-size=768"] : []), join(ROOT, "node_modules/@playwright/test/cli.js"), "test", "e2e/plan-capability-recovery.spec.ts", "--project=chromium", "--workers=1", "--trace=off", ...(staged ? ["--retries=0", "--max-failures=1"] : [])], {
    env: staged ? { ...env, NODE_OPTIONS: "--max-old-space-size=768", CIRCLE_NODE_TOTAL: "2", RAYON_NUM_THREADS: "1", UV_THREADPOOL_SIZE: "1" } : env,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Disposable Plan auth failed.");
  process.exitCode = interrupted ? 130 : 1;
} finally {
  let groupsStopped = false;
  try { await stopProcessGroups(); groupsStopped = true; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  if (started && groupsStopped) {
    try { await command("supabase", ["stop", "--no-backup", "--workdir", workdir], { capture: true, cleanup: true }); }
    catch { console.error(`Could not remove owned project ${projectId}. Preserve ${workdir} for recovery.`); process.exitCode = 1; }
  }
  if (!process.exitCode) rmSync(workdir, { recursive: true, force: true });
  if (groupsStopped) {
    await stopProcessGroups();
    rmSync(join(ROOT, dist), { recursive: true, force: true });
  }
  stageInput?.close();
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
