/** Run the price-bearing Plan browser spec against a private disposable DB. */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startDisposablePlanDb } from "./disposable-plan-db.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SPEC = "e2e/plan-selected-drink-disposable.spec.ts";
const DIST_DIR = `.next-disposable-plan-${process.pid}`;

async function pickPort() {
  const server = createTcpServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function loopbackUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" ||
      parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Disposable Plan browser requires a bare loopback HTTP URL");
  }
  return parsed;
}

async function startRestAdapter(restBaseUrl) {
  loopbackUrl(restBaseUrl);
  const server = createServer(async (request, response) => {
    if (!request.url?.startsWith("/rest/v1/")) {
      response.writeHead(404).end();
      return;
    }
    try {
      const target = new URL(request.url.slice("/rest/v1".length), restBaseUrl);
      if (target.origin !== new URL(restBaseUrl).origin) {
        response.writeHead(400).end();
        return;
      }
      const headers = {};
      for (const name of ["accept", "content-type", "prefer", "authorization", "apikey", "range", "accept-profile", "content-profile"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        redirect: "manual",
      });
      for (const name of ["content-type", "content-range", "preference-applied", "location"]) {
        const value = upstream.headers.get(name);
        if (value) response.setHeader(name, value);
      }
      response.writeHead(upstream.status);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.writeHead(502).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

async function run() {
  let db;
  let adapter;
  let child;
  let interrupted = false;
  const stopChildGroup = () => {
    if (!child?.pid) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };
  const interrupt = () => {
    interrupted = true;
    stopChildGroup();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    db = await startDisposablePlanDb();
    if (interrupted) return 130;
    adapter = await startRestAdapter(db.restBaseUrl);
    const port = await pickPort();
    const env = { ...process.env };
    for (const name of ["DATABASE_URL", "DIRECT_URL", "OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "VERCEL_ENV", "PW_E2E_ADMIN_TOKEN"]) {
      delete env[name];
    }
    Object.assign(env, {
      PW_DISPOSABLE_PLAN_DB: "1",
      PW_DISPOSABLE_SUPABASE_URL: adapter.url,
      PW_DISPOSABLE_SERVICE_ROLE_KEY: db.serviceRoleKey,
      PW_PORT: String(port),
      PW_SKIP_WEBSERVER: "0",
      PW_SKIP_KEYLESS_WEBSERVER: "1",
      PW_SCREENSHOTS: "",
      PUBMAX_E2E_LOGIN: "0",
      PW_NEXT_DIST_DIR: DIST_DIR,
      NEXT_PUBLIC_SUPABASE_URL: adapter.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_pubmaxx_e2e",
      OPENROUTER_API_KEY: "",
      VERCEL_ENV: "development",
      PUBMAX_TRACKED_OUTPUTS: "public/data",
    });
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [
        join(ROOT, "node_modules/@playwright/test/cli.js"),
        "test", SPEC, "--project=chromium", "--workers=1", "--trace=on",
      ], { cwd: ROOT, env, stdio: "inherit", detached: true });
      child.once("error", reject);
      child.once("exit", (exitCode, signal) => resolve(signal ? 130 : exitCode ?? 1));
      if (interrupted) stopChildGroup();
    });
    return interrupted ? 130 : code;
  } finally {
    stopChildGroup();
    if (adapter) await adapter.stop();
    if (db) await db.stop();
    rmSync(join(ROOT, DIST_DIR), { recursive: true, force: true });
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
