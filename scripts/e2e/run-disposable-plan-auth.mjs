import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { removeSupabaseProjectLeftovers } from "./supabase-project-cleanup.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
if (process.argv.length !== 2) throw new Error("Usage: node scripts/e2e/run-disposable-plan-auth.mjs");
const dockerHost = process.env.DOCKER_HOST;
if (!dockerHost?.startsWith("unix://") || !isAbsolute(dockerHost.slice(7)) || !existsSync(dockerHost.slice(7))
  || ["DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"].some((key) => process.env[key]?.trim())) {
  throw new Error("Set DOCKER_HOST to the configured local Docker socket, without context or TLS overrides.");
}
const projectId = `pubmax-auth-${randomBytes(6).toString("hex")}`;
const workdir = mkdtempSync(join(ROOT, ".plan-auth-"));
const dist = `.next-${projectId}`;
// A production build starts email sign-in on pubmaxxing.com and its CSP keeps
// the browser off a local GoTrue, so the emailed-link journey runs on next dev.
const devDist = `.next-${projectId}-dev`;
const admittedMigrations = new Set();
const processGroups = new Set();
let started = false;
let interrupted = false;
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

async function command(program, args, { capture = false, env = process.env, cleanup = false } = {}) {
  if (interrupted && !cleanup) throw new Error("Disposable Plan auth interrupted.");
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: ROOT, env, detached: true, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    if (child.pid) processGroups.add(child.pid);
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        output += chunk.subarray(0, Math.max(0, 1024 * 1024 - Buffer.byteLength(output))).toString("utf8");
      });
      child.stderr.resume();
    }
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (interrupted && !cleanup) reject(new Error("Disposable Plan auth interrupted."));
      else if (code === 0) resolve(output);
      else reject(new Error(`${program} ${args[0]} failed (${signal ?? code}).`));
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

const interrupt = () => {
  interrupted = true;
  process.exitCode = 130;
  for (const pid of processGroups) signalGroup(pid, "SIGTERM");
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  await command("docker", ["info"], { capture: true });
  await command("supabase", ["init", "--workdir", workdir], { capture: true });
  const configPath = join(workdir, "supabase/config.toml");
  let config = readFileSync(configPath, "utf8").replace(/^project_id = .*$/m, `project_id = "${projectId}"`);
  const devPort = await port();
  const mailPort = await port();
  const devOrigin = `http://localhost:${devPort}`;
  for (const [section, key, value] of [
    ["api", "port", await port()],
    ["db", "port", await port()],
    ["db", "shadow_port", await port()],
    ["db", "major_version", 17],
    ["db.seed", "enabled", false],
    ["studio", "enabled", false],
    ["local_smtp", "enabled", true],
    ["local_smtp", "port", mailPort],
    ["auth", "site_url", JSON.stringify(devOrigin)],
    ["auth", "additional_redirect_urls", JSON.stringify([`${devOrigin}/**`])],
    ["realtime", "enabled", true],
    ["storage", "enabled", false],
    ["edge_runtime", "enabled", false],
    ["analytics", "enabled", false],
  ]) config = configure(config, section, key, value);
  writeFileSync(configPath, config);
  const migrationTree = await command("git", ["ls-tree", "-rz", "HEAD", "--", "supabase/migrations"], { capture: true });
  for (const entry of migrationTree.split("\0").filter(Boolean)) {
    const match = /^100644 blob ([a-f0-9]{40})\tsupabase\/migrations\/([0-9]{14}_[a-z0-9_]+\.sql)$/.exec(entry);
    if (!match) continue;
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
  started = true;
  await command("supabase", ["start", "--output-format", "stream-json", "--workdir", workdir, "--exclude", "realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"], { capture: true });
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
  });
  const playwright = (specs, grep, overrides) => command(process.execPath, [
    join(ROOT, "node_modules/@playwright/test/cli.js"),
    "test", ...specs, "--grep", grep,
    "--project=chromium", "--workers=1", "--trace=off",
  ], { env: { ...env, ...overrides } });
  await playwright(["e2e/plan-capability-recovery.spec.ts"], "Plan capability recovery", {});
  await playwright(["e2e/log-intent-composer.spec.ts"], "new phone account", {
    PW_PORT: String(devPort), PW_NEXT_DIST_DIR: devDist, PW_DEV_SERVER: "1",
    PW_DISPOSABLE_MAIL_URL: `http://127.0.0.1:${mailPort}`,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Disposable Plan auth failed.");
  process.exitCode = interrupted ? 130 : 1;
} finally {
  let groupsStopped = false;
  let backendStopped = !started;
  try { await stopProcessGroups(); groupsStopped = true; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  if (started && groupsStopped) {
    const cleanup = (program, args) => command(program, args, { capture: true, cleanup: true });
    try { await cleanup("supabase", ["stop", "--no-backup", "--workdir", workdir]); }
    catch { console.error(`supabase stop failed for ${projectId}. Removing its Docker resources by name.`); }
    try {
      const remaining = await removeSupabaseProjectLeftovers(projectId, cleanup);
      backendStopped = remaining.length === 0;
      if (!backendStopped) console.error(`Docker still holds ${remaining.join(", ")}.`);
    } catch (error) { console.error(error.message); }
    if (!backendStopped) {
      console.error(`Could not remove owned project ${projectId}. Preserve ${workdir} for recovery.`);
      process.exitCode = 1;
    }
  }
  if (groupsStopped) {
    await stopProcessGroups();
    rmSync(join(ROOT, dist), { recursive: true, force: true });
    rmSync(join(ROOT, devDist), { recursive: true, force: true });
    if (backendStopped) rmSync(workdir, { recursive: true, force: true });
  }
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
