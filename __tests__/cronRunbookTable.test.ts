import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The runbook's "What runs, when" table is the owner's only plain-language view
// of the cron plane, and vercel.json cannot carry comments. A table row is held
// to vercel.json for its route and schedules and to the maxDuration its route
// module exports, so a schedule change that skips the runbook fails here.

const ROOT = process.cwd();
const RUNBOOK = join(ROOT, "docs", "CRON_PLANE_RUNBOOK.md");

interface TableRow {
  route: string;
  schedules: string[];
  maxDurationSeconds: number;
}

function vercelSchedulesByRoute(): Map<string, string[]> {
  const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  const byRoute = new Map<string, string[]>();
  for (const cron of config.crons ?? []) {
    byRoute.set(cron.path, [...(byRoute.get(cron.path) ?? []), cron.schedule]);
  }
  return byRoute;
}

function runbookTableRows(): TableRow[] {
  const markdown = readFileSync(RUNBOOK, "utf8");
  const start = markdown.indexOf("\n## What runs, when\n");
  expect(start, "runbook has a '## What runs, when' section").toBeGreaterThan(-1);
  const end = markdown.indexOf("\n## ", start + 1);
  const section = markdown.slice(start, end === -1 ? undefined : end);

  const rows: TableRow[] = [];
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const route = /^`GET (\/api\/cron\/[^`]+)`$/.exec(cells[1] ?? "")?.[1];
    if (!route) continue;
    const schedules = [...(cells[2] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
    const maxDuration = /^(\d+)s$/.exec(cells[5] ?? "")?.[1];
    expect(maxDuration, `${route} row ends in a maxDuration such as 30s`).toBeDefined();
    rows.push({ route, schedules, maxDurationSeconds: Number(maxDuration) });
  }
  return rows;
}

async function routeMaxDuration(route: string): Promise<unknown> {
  const mod = (await import(join(ROOT, "app", ...route.split("/").filter(Boolean), "route.ts"))) as {
    maxDuration?: unknown;
  };
  return mod.maxDuration;
}

describe("cron runbook What-runs-when table", () => {
  const vercel = vercelSchedulesByRoute();
  const rows = runbookTableRows();

  it("lists each vercel.json cron route exactly once", () => {
    const routes = rows.map((row) => row.route);
    expect(new Set(routes).size, "no route has two rows").toBe(routes.length);
    expect([...routes].sort()).toEqual([...vercel.keys()].sort());
  });

  it("gives each route the schedules vercel.json runs it on", () => {
    for (const row of rows) {
      expect([...row.schedules].sort(), `${row.route} schedules`).toEqual(
        [...(vercel.get(row.route) ?? [])].sort(),
      );
    }
  });

  it("gives each route the maxDuration its route module exports", async () => {
    for (const row of rows) {
      expect(row.maxDurationSeconds, `${row.route} maxDuration`).toBe(await routeMaxDuration(row.route));
    }
  });
});
