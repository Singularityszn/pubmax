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

import { readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { defined } from "@/__tests__/helpers/defined";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";
import {
  UPTIME_PROBES,
  UPTIME_REQUEST_TIMEOUT_MS,
  UPTIME_RETRY_DELAY_MS,
  checkUptime,
  runUptimeCheck,
} from "@/scripts/ci/uptime-check.mjs";

const ROOT = process.cwd();
const WORKFLOW_FILE = ".github/workflows/uptime.yml";
const SCRIPT = "scripts/ci/uptime-check.mjs";

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; "timeout-minutes"?: number };
type Job = {
  name?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
};
type Workflow = {
  name?: string;
  on: Record<string, unknown>;
  permissions?: unknown;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs: Record<string, Job>;
};

const source = readFileSync(join(ROOT, WORKFLOW_FILE), "utf8");
const workflow = parse(source) as Workflow;
const jobs = Object.values(workflow.jobs);
const job = defined(jobs[0], "the uptime job");

/** Every minute of the hour a cron minute field fires on. */
function cronMinutes(field: string): number[] {
  const minutes = new Set<number>();
  for (const part of field.split(",")) {
    const [range = "", stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    const [low, high] = range === "*" ? [0, 59] : range.includes("-") ? range.split("-").map(Number) : [Number(range), stepText === undefined ? Number(range) : 59];
    for (let minute = defined(low); minute <= defined(high); minute += step) minutes.add(minute);
  }
  return [...minutes].sort((a, b) => a - b);
}

/** The repository files a module reaches through relative imports, itself included. */
function importClosure(entry: string): { files: string[]; bare: string[] } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const text = readFileSync(join(ROOT, file), "utf8");
    const specifiers = [
      ...text.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...text.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
      ...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => defined(match[1]));
    for (const specifier of specifiers) {
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) {
        bare.add(specifier);
        continue;
      }
      visit(relative(ROOT, normalize(join(ROOT, dirname(file), specifier))).split("\\").join("/"));
    }
  };
  visit(entry);
  return { files: [...files].sort(), bare: [...bare].sort() };
}

function expressions(value: unknown): string[] {
  if (typeof value === "string") return [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) => defined(match[1]));
  if (Array.isArray(value)) return value.flatMap(expressions);
  if (value && typeof value === "object") return Object.values(value).flatMap(expressions);
  return [];
}

describe("the uptime workflow", () => {
  it("asks every five minutes on a schedule, and can be started by hand", () => {
    expect(workflow.name).toBe("Production uptime");
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    const schedule = workflow.on.schedule as Array<{ cron: string }>;
    expect(schedule).toHaveLength(1);
    const fields = defined(schedule[0]).cron.trim().split(/\s+/);
    expect(fields).toHaveLength(5);
    expect(fields.slice(1)).toEqual(["*", "*", "*", "*"]);
    const minutes = cronMinutes(defined(fields[0]));
    expect(minutes).toHaveLength(12);
    const gaps = minutes.map((minute, index) => (defined(minutes[(index + 1) % minutes.length]) - minute + 60) % 60);
    expect(new Set(gaps)).toEqual(new Set([5]));
    // The top of the hour is when GitHub's queue is busiest and drops runs.
    expect(minutes).not.toContain(0);
  });

  it("is one small Linux job that holds nothing but a read of its own repository", () => {
    expect(jobs).toHaveLength(1);
    expect(workflow.permissions).toEqual({});
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(5);
    expect(job.env).toBeUndefined();
  });

  it("runs one check at a time and never cancels one that has started", () => {
    expect(workflow.concurrency).toEqual({ group: "${{ github.workflow }}", "cancel-in-progress": false });
  });

  it("reads no secret, sends none, and puts no expression in a shell line", () => {
    for (const expression of expressions(workflow)) expect(expression).not.toMatch(/\bsecrets\b/);
    for (const step of job.steps) {
      if (step.run) expect(step.run).not.toContain("${{");
    }
  });

  it("names no host of its own, so the monitor and the app read one origin", () => {
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toContain(new URL(PRODUCTION_SITE_ORIGIN).hostname);
    const runs = job.steps.flatMap((step) => (step.run ? [step.run.trim()] : []));
    expect(runs).toEqual([`node ${SCRIPT}`]);
  });

  it("checks out exactly the files the check imports, and no credential", () => {
    const checkout = defined(job.steps.find((step) => step.uses?.startsWith("actions/checkout@")), "checkout");
    expect(checkout.with?.["persist-credentials"]).toBe(false);
    expect(checkout.with?.["sparse-checkout-cone-mode"]).toBe(false);
    const sparse = String(checkout.with?.["sparse-checkout"] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\//, ""))
      .sort();
    const closure = importClosure(SCRIPT);
    expect(sparse).toEqual(closure.files);
    // No `npm ci` runs, so a package import would fail in production at 3am.
    expect(closure.bare).toEqual([]);
    expect(closure.files).toContain("lib/siteUrlConfig.mjs");
  });

  it("is watched by the alert workflow, which posts a failed scheduled run", () => {
    const alert = parse(readFileSync(join(ROOT, ".github/workflows/alert-on-failure.yml"), "utf8")) as {
      on: { workflow_run: { workflows: string[] } };
    };
    expect(alert.on.workflow_run.workflows).toContain("Production uptime");
  });
});

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
    // Two asks, a pause and a margin fit well inside the job's wall.
    const jobWallMs = defined(job["timeout-minutes"]) * 60_000;
    expect(2 * UPTIME_REQUEST_TIMEOUT_MS + UPTIME_RETRY_DELAY_MS).toBeLessThan(jobWallMs / 2);
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
