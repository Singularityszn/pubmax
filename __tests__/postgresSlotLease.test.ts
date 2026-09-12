import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireClusterSlot, maxPostgresClusters, POSTGRES_SLOT_PORT_BASE } from "../scripts/rls/postgresHost.mjs";

const children = new Set<ChildProcess>();
const probes = new Set<Server>();
const releases: (() => void)[] = [];
const roots: string[] = [];
const moduleUrl = pathToFileURL(join(process.cwd(), "scripts/rls/postgresHost.mjs")).href;
function child(code: string, env: Record<string, string> = {}) {
  const processHandle = spawn(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, PUBMAX_PG_MAX_CLUSTERS: "1", ...env },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(processHandle);
  let output = "";
  processHandle.stdout!.on("data", data => { output += data; });
  processHandle.stderr!.on("data", data => { output += data; });
  const done = once(processHandle, "exit").then(([code, signal]) => ({ code, signal, output }));
  return { processHandle, done };
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.all([...probes].map(probe => new Promise<void>(resolve => probe.close(() => resolve()))));
  probes.clear();
  await Promise.all([...children].map(async processHandle => {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
    const ended = once(processHandle, "exit");
    processHandle.kill("SIGKILL");
    await ended;
  }));
  children.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("PostgreSQL slot leases", () => {
  it("serializes real workers across different temporary roots", async () => {
    const root = mkdtempSync(join(tmpdir(), "pubmax-slot-contention-"));
    roots.push(root);
    const marker = join(root, "critical");
    const workers = Array.from({ length: 4 }, () => {
      const workerRoot = mkdtempSync(join(root, "worker-"));
      return child(`
        import { mkdirSync, rmSync } from 'node:fs';
        import { setTimeout as sleep } from 'node:timers/promises';
        const { acquireClusterSlot } = await import(${JSON.stringify(moduleUrl)});
        for (let i = 0; i < 8; i++) {
          const release = await acquireClusterSlot('contention');
          try {
            mkdirSync(${JSON.stringify(marker)});
            await sleep(5);
            rmSync(${JSON.stringify(marker)}, { recursive: true });
          } finally { release(); }
        }
        process.disconnect();
      `, { TMPDIR: workerRoot });
    });
    const outcomes = await Promise.all(workers.map(worker => worker.done));
    expect(outcomes).toEqual(outcomes.map(() => ({ code: 0, signal: null, output: "" })));
  }, 180_000);

  it("releases a killed worker's slot without a file reaper", async () => {
    const holder = child(`
      const { acquireClusterSlot } = await import(${JSON.stringify(moduleUrl)});
      process.on('message', () => {});
      await acquireClusterSlot('killed holder');
      process.send('held');
    `);
    const [message] = await once(holder.processHandle, "message");
    expect(message).toBe("held");
    holder.processHandle.kill("SIGKILL");
    expect((await holder.done).signal).toBe("SIGKILL");
    vi.stubEnv("PUBMAX_PG_MAX_CLUSTERS", "1");
    const release = await acquireClusterSlot("after killed holder");
    releases.push(release);
    expect(typeof release).toBe("function");
  }, 180_000);

  it("a repeated old release cannot close a replacement lease", async () => {
    vi.stubEnv("PUBMAX_PG_MAX_CLUSTERS", "1");
    const first = await acquireClusterSlot("first");
    releases.push(first);
    first();
    const second = await acquireClusterSlot("second");
    releases.push(second);
    first();
    const probe = createServer();
    probes.add(probe);
    try {
      const outcome = await new Promise<string | undefined>(resolve => {
        probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code));
        probe.once("listening", () => resolve("listening"));
        probe.listen({ host: "127.0.0.1", port: POSTGRES_SLOT_PORT_BASE, exclusive: true });
      });
      expect(outcome).toBe("EADDRINUSE");
    } finally {
      await new Promise<void>(resolve => probe.close(() => resolve()));
      probe.removeAllListeners();
      probes.delete(probe);
    }
  }, 180_000);

  it("closes failed attempts and reports binding errors without retrying", async () => {
    const worker = child(`
      import net from 'node:net';
      import { EventEmitter } from 'node:events';
      import { syncBuiltinESMExports } from 'node:module';
      let attempts = 0;
      let closed = false;
      net.createServer = () => {
        const server = new EventEmitter();
        server.listen = () => {
          attempts++;
          queueMicrotask(() => server.emit('error', Object.assign(new Error('denied'), { code: 'EACCES' })));
        };
        server.close = callback => { closed = true; callback?.(); };
        return server;
      };
      syncBuiltinESMExports();
      const { acquireClusterSlot } = await import(${JSON.stringify(moduleUrl)});
      const deadline = setTimeout(() => process.exit(2), 2000);
      try { await acquireClusterSlot('binding error'); process.exitCode = 1; }
      catch (error) { console.log(JSON.stringify({ code: error.code, attempts, closed })); }
      clearTimeout(deadline);
      process.disconnect();
    `);
    const outcome = await worker.done;
    expect(outcome.code).toBe(0);
    expect(JSON.parse(outcome.output)).toEqual({ code: "EACCES", attempts: 1, closed: true });
  });

  it("does not silently release a held slot after a listener error", async () => {
    const worker = child(`
      import net from 'node:net';
      import { EventEmitter } from 'node:events';
      import { syncBuiltinESMExports } from 'node:module';
      let closed = false;
      let server;
      net.createServer = () => {
        server = new EventEmitter();
        server.listen = (_options, ready) => queueMicrotask(ready);
        server.unref = () => {};
        server.close = callback => { closed = true; callback?.(); };
        return server;
      };
      syncBuiltinESMExports();
      const { acquireClusterSlot } = await import(${JSON.stringify(moduleUrl)});
      const release = await acquireClusterSlot('held error');
      let thrown = false;
      try { server.emit('error', Object.assign(new Error('held listener failed'), { code: 'EIO' })); }
      catch (error) { thrown = error.code === 'EIO'; }
      console.log(JSON.stringify({ thrown, closed }));
      release();
      process.disconnect();
    `);
    const outcome = await worker.done;
    expect(outcome.code).toBe(0);
    expect(JSON.parse(outcome.output)).toEqual({ thrown: true, closed: false });
  });

  it("refuses a budget outside the valid port range", () => {
    vi.stubEnv("PUBMAX_PG_MAX_CLUSTERS", "65535");
    expect(() => maxPostgresClusters()).toThrow("exceeds the available slot ports");
  });
});
