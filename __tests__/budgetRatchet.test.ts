import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PERFORMANCE_BUDGETS } from "../lib/performanceBudgets";

/**
 * The pawl on the ratchet, driven through a real repository.
 *
 * `docs/PERFORMANCE_BUDGETS.md` says a ceiling comes down freely and goes up
 * only deliberately, with a reason and a measured figure. #1314 is the record
 * of what makes that law hard to keep: when the gate fails, raising the ceiling
 * is the fastest way to make the red go away. So the check does not forbid a
 * raise - it makes one impossible to do quietly.
 *
 * These cases build two commits with real budget files and run the script over
 * them, because the thing under test is a comparison against a git ref.
 */
const SCRIPT = join(process.cwd(), "scripts/check-budget-ratchet.mjs");

let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function writeBudgets(routes: unknown[]): void {
  mkdirSync(join(repo, "perf"), { recursive: true });
  writeFileSync(
    join(repo, "perf/route-budgets.json"),
    `${JSON.stringify({ note: "test", method: PERFORMANCE_BUDGETS.method, routes }, null, 2)}\n`,
  );
}

function route(path: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path,
    readySelector: "main",
    why: "a route",
    serverRenderMs: 150,
    jsDecodedKB: 1000,
    requests: 50,
    lcpMs: 2500,
    ...over,
  };
}

function run(): { status: number; output: string } {
  try {
    const output = execFileSync("node", [SCRIPT, "main"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "pubmax-ratchet-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeBudgets([route("/"), route("/map")]);
  git("add", "-A");
  git("commit", "-qm", "base");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("check-budget-ratchet", () => {
  it("passes an unchanged file", () => {
    expect(run().status).toBe(0);
  });

  it("passes a ceiling taken down, because down is free", () => {
    writeBudgets([route("/", { jsDecodedKB: 800 }), route("/map")]);
    const result = run();
    expect(result.status).toBe(0);
  });

  it("refuses a ceiling taken up with no record", () => {
    writeBudgets([route("/", { requests: 99 }), route("/map")]);
    const result = run();

    expect(result.status).toBe(1);
    expect(result.output).toContain("/ requests: ceiling raised from 50 to 99 with no record");
  });

  it("refuses a route quietly removed, because an unmeasured route never fails again", () => {
    writeBudgets([route("/")]);
    const result = run();

    expect(result.status).toBe(1);
    expect(result.output).toContain("/map: removed from the budget file");
  });

  it("allows a raise that carries a record, and says so out loud", () => {
    writeBudgets([
      route("/", {
        requests: 60,
        ceilingRaises: [
          {
            metric: "requests",
            from: 50,
            to: 60,
            measured: 52,
            why: "the rig gained a network profile, so the same build asks for more before it is interactive",
          },
        ],
      }),
      route("/map"),
    ]);
    const result = run();

    expect(result.status).toBe(0);
    // Allowed is not the same as unremarked.
    expect(result.output).toContain("1 ceiling(s) went UP with a record");
    expect(result.output).toContain("/ requests: 50 to 60, measured 52");
  });

  it("refuses a record written from memory rather than from the base branch", () => {
    writeBudgets([
      route("/", {
        requests: 60,
        ceilingRaises: [
          {
            metric: "requests",
            from: 55,
            to: 60,
            measured: 52,
            why: "a reason long enough to pass the length check but a from that is not true",
          },
        ],
      }),
      route("/map"),
    ]);
    const result = run();

    expect(result.status).toBe(1);
    expect(result.output).toContain("says it came from 55, but main has 50");
  });

  it("refuses a record with no measured figure", () => {
    writeBudgets([
      route("/", {
        requests: 60,
        ceilingRaises: [
          {
            metric: "requests",
            from: 50,
            to: 60,
            why: "the law asks for a figure measured rather than guessed, and this record has none",
          },
        ],
      }),
      route("/map"),
    ]);
    const result = run();

    expect(result.status).toBe(1);
    expect(result.output).toContain("carries no measured figure");
  });

  it("refuses the /map pin-ready target being taken back up", () => {
    const pin = {
      path: "/map/london",
      targetMs: 2500,
      measuredMs: 3336,
      signal: "x",
      viewport: { width: 390, height: 844 },
      note: "n",
    };
    writeBudgets([route("/"), route("/map", { pinReady: pin })]);
    git("add", "-A");
    git("commit", "-qm", "pin");
    writeBudgets([route("/"), route("/map", { pinReady: { ...pin, targetMs: 4000 } })]);
    const result = run();

    expect(result.status).toBe(1);
    expect(result.output).toContain("raised from 2500 to 4000");
  });

  it("reports rather than fails when the base ref cannot be read", () => {
    const result = (() => {
      try {
        const output = execFileSync("node", [SCRIPT, "no-such-ref"], {
          cwd: repo,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { status: 0, output };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
      }
    })();

    // A check that could not run says so rather than going quiet or going red.
    expect(result.status).toBe(0);
    expect(result.output).toContain("nothing was compared");
  });
});

describe("the shipped budget file", () => {
  it("budgets every route the site serves a stranger", () => {
    // Existing route rows plus the canonical discovery tab query. Retired
    // discovery URLs keep separate redirect rows so the page stays measured.
    // docs/PERFORMANCE_BUDGETS.md "Which routes are budgeted" holds the list;
    // __tests__/sitemap.test.ts fails a family that is advertised and unmeasured.
    expect(PERFORMANCE_BUDGETS.routes).toHaveLength(47);
    const discovery = PERFORMANCE_BUDGETS.routes.find((route) => route.path === "/social?tab=discover");
    expect(discovery).toBeDefined();
    expect(discovery?.redirectsTo).toBeUndefined();
    for (const path of ["/discover", "/drinks"]) {
      expect(PERFORMANCE_BUDGETS.routes.find((route) => route.path === path)?.redirectsTo)
        .toBe(discovery?.path);
    }
  });

  it("gives every route a readiness selector and a reason", () => {
    for (const route of PERFORMANCE_BUDGETS.routes) {
      expect(route.readySelector, route.path).toBeTruthy();
      expect(route.why.length, route.path).toBeGreaterThan(20);
    }
  });

  it("holds every route to the good LCP boundary or better", () => {
    // No route may be worse than the Core Web Vitals good boundary.
    for (const route of PERFORMANCE_BUDGETS.routes) {
      expect(route.lcpMs, route.path).toBeLessThanOrEqual(2500);
    }
  });

  it("holds the front door and the product to the programme's own 1500", () => {
    for (const path of ["/", "/map"]) {
      const route = PERFORMANCE_BUDGETS.routes.find((entry) => entry.path === path);
      expect(route?.lcpMs, path).toBeLessThanOrEqual(1500);
    }
  });

  it("measures over a named network rather than over loopback", () => {
    const network = PERFORMANCE_BUDGETS.method.network;
    expect(network.profile).not.toBe("loopback");
    expect(network.latencyMs).toBeGreaterThan(0);
    expect(network.downloadBytesPerSecond).toBeGreaterThan(0);
  });

  it("keeps one owner for the /map pin-ready target", () => {
    const map = PERFORMANCE_BUDGETS.routes.find((route) => route.path === "/map");
    expect(map?.pinReady?.targetMs).toBeDefined();
  });
});
