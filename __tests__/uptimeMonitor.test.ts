// NOTHING TOLD ANYBODY WHEN PRODUCTION WAS DOWN.
//
// Launch plan R3 (docs/plans/LAUNCH_PLAN_2026-11-01.md, section 6) found no
// uptime monitor at all. `.github/workflows/uptime.yml` asks /api/health and
// /api/version every five minutes through `scripts/ci/uptime-check.mjs`, asks a
// failed route once more, and fails the run only when a route failed twice, so
// `.github/workflows/alert-on-failure.yml` posts a real outage and not a
// dropped packet. These pins hold four things: the schedule and the job shape,
// the origin coming from the one constant the app reads, the two-strike rule,
// and a log that never prints a body or a value the network chose.

import { describe, expect, it, vi } from "vitest";

import { defined } from "@/__tests__/helpers/defined";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";
import {
  UPTIME_PROBES,
  UPTIME_REQUEST_TIMEOUT_MS,
  UPTIME_RETRY_DELAY_MS,
  checkUptime,
  runUptimeCheck,
} from "@/scripts/ci/uptime-check.mjs";

type Answer = { status: number; body?: string | null; headers?: Record<string, string> };
type Script = Record<string, Array<Answer | Error>>;

/** A fetch that answers each path from its own queue, in order, and records every call. */
function scriptedFetch(script: Script) {
  const queues = new Map(Object.entries(script).map(([path, answers]) => [path, [...answers]]));
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const queue = defined(queues.get(new URL(url).pathname), `answers for ${url}`);
    const next = defined(queue.shift(), `another answer for ${url}`);
    if (next instanceof Error) throw next;
    return new Response(next.body ?? null, { status: next.status, headers: next.headers });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const healthy = (id = "dpl_launch1"): Answer => ({
  status: 200,
  body: JSON.stringify({ ok: true, deploymentId: id, database: "ok" }),
});
const versionOk = (id = "dpl_launch1"): Answer => ({
  status: 200,
  body: JSON.stringify({ ok: true, deploymentId: id, gitCommitSha: "a".repeat(40) }),
});
const databaseDown: Answer = {
  status: 503,
  body: JSON.stringify({ error: "The database is not answering.", code: "DATABASE_UNAVAILABLE", ok: false }),
};

function networkError(code: string): Error {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}

async function run(script: Script) {
  const { fetchImpl, calls } = scriptedFetch(script);
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const lines: string[] = [];
  const exitCode = await runUptimeCheck({ fetchImpl, sleep, log: (line) => lines.push(line) });
  return { exitCode, calls, sleep, lines, output: lines.join("\n") };
}

describe("the check", () => {
  it("asks the two routes on the canonical origin, by GET, with no credential and no redirect", async () => {
    const { exitCode, calls, sleep, output } = await run({
      "/api/health": [healthy()],
      "/api/version": [versionOk()],
    });
    expect(exitCode).toBe(0);
    expect(sleep).not.toHaveBeenCalled();
    expect(calls.map((call) => call.url).sort()).toEqual(
      UPTIME_PROBES.map((probe) => `${PRODUCTION_SITE_ORIGIN}${probe.path}`).sort(),
    );
    expect(UPTIME_PROBES.map((probe) => probe.path)).toEqual(["/api/health", "/api/version"]);
    for (const { init } of calls) {
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(init.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
    }
    expect(output).toContain("UP /api/health: 200");
    expect(output).toContain("deployment dpl_launch1");
    expect(output).toContain("Production is up.");
    expect(output).not.toContain("::error");
  });

  it("waits longer than the health route holds an answer before it asks again", () => {
    expect(UPTIME_RETRY_DELAY_MS).toBeGreaterThan(15_000);
    expect(UPTIME_REQUEST_TIMEOUT_MS).toBeGreaterThan(4_000);
  });

  it("calls one failure a flap: a warning, a green run and no alert", async () => {
    const { exitCode, calls, sleep, lines } = await run({
      "/api/health": [databaseDown, healthy()],
      "/api/version": [versionOk()],
    });
    expect(exitCode).toBe(0);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(UPTIME_RETRY_DELAY_MS);
    // Only the route that failed is asked again.
    expect(calls.filter((call) => call.url.endsWith("/api/version"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/api/health"))).toHaveLength(2);
    const warning = defined(lines.find((line) => line.startsWith("::warning ")), "the warning line");
    expect(warning).toContain("/api/health failed once (answered 503)");
    expect(lines.some((line) => line.startsWith("::error "))).toBe(false);
    expect(lines.at(-1)).toBe("Production is up.");
  });

  it("calls two failures in a row down, fails the run, and points at the database", async () => {
    const { exitCode, lines } = await run({
      "/api/health": [databaseDown, databaseDown],
      "/api/version": [versionOk()],
    });
    expect(exitCode).toBe(1);
    const error = defined(lines.find((line) => line.startsWith("::error ")), "the error line");
    expect(error).toMatch(/^::error title=Production is down::\/api\/health failed twice, 30 s apart: answered 503, then answered 503\.$/);
    expect(lines).toContain("Production is down: /api/health.");
    expect(lines.at(-1)).toBe("The site answers but its database does not. Read the Supabase dashboard first.");
  });

  it("says nothing answered when both routes fail twice at the network", async () => {
    const { exitCode, lines } = await run({
      "/api/health": [networkError("ENOTFOUND"), networkError("ENOTFOUND")],
      "/api/version": [networkError("ECONNRESET"), networkError("ECONNRESET")],
    });
    expect(exitCode).toBe(1);
    expect(lines.filter((line) => line.startsWith("::error "))).toHaveLength(2);
    expect(lines.join("\n")).toContain("the request failed (ENOTFOUND), then the request failed (ENOTFOUND)");
    expect(lines).toContain("Production is down: /api/health and /api/version.");
    expect(lines.at(-1)).toBe("Nothing answered. Read Vercel first: the deployment, its logs and the firewall.");
  });

  it("gives up on a route that never answers, through the signal it hands to fetch", async () => {
    const hanging = vi.fn(
      (_input: string | URL | Request, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const entries = await checkUptime({
      fetchImpl: hanging as unknown as typeof fetch,
      sleep: async () => {},
      timeoutMs: 30,
    });
    expect(entries.map((entry) => entry.state)).toEqual(["down", "down"]);
    for (const entry of entries) expect(entry.first.reason).toMatch(/^no answer within /);
  });

  it("refuses a 200 that does not say the database is ok, a page that is not JSON, and a redirect", async () => {
    const notOk = await run({
      "/api/health": [
        { status: 200, body: JSON.stringify({ ok: true, database: "not_configured" }) },
        { status: 200, body: "<!doctype html><title>Parked</title>" },
      ],
      "/api/version": [
        { status: 308, headers: { location: "https://example.invalid/api/version" } },
        { status: 308, headers: { location: "https://example.invalid/api/version" } },
      ],
    });
    expect(notOk.exitCode).toBe(1);
    expect(notOk.output).toContain(
      "answered 200, but the body did not say the database is ok, then answered 200 with a body that is not JSON",
    );
    expect(notOk.output).toContain("/api/version failed twice, 30 s apart: answered 308, then answered 308.");
  });

  it("names the Vercel firewall when it is the one that answered", async () => {
    const { exitCode, output } = await run({
      "/api/health": [
        { status: 429, headers: { "x-vercel-mitigated": "deny" } },
        { status: 403, headers: { "x-vercel-mitigated": "challenge" } },
      ],
      "/api/version": [versionOk()],
    });
    expect(exitCode).toBe(1);
    expect(output).toContain("answered 429, Vercel firewall deny, then answered 403, Vercel firewall challenge.");
  });

  it("never prints a body, and never a value the network chose that could be a workflow command", async () => {
    const { exitCode, output } = await run({
      "/api/health": [
        { status: 500, body: "secret-token-in-a-stack-trace" },
        { status: 200, body: JSON.stringify({ ok: true, database: "ok", deploymentId: "::add-mask::dpl" }) },
      ],
      "/api/version": [
        { status: 200, body: JSON.stringify({ ok: true, deploymentId: "dpl_x\n::error::forged" }) },
      ],
    });
    expect(exitCode).toBe(0);
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("add-mask");
    expect(output).not.toContain("forged");
    for (const line of output.split("\n")) {
      if (line.startsWith("::")) expect(line).toMatch(/^::warning title=Production answered on the retry::/);
    }
    expect(output.split("\n")[0]).toBe(`Checking ${PRODUCTION_SITE_ORIGIN}.`);
  });
});
