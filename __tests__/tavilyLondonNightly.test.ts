import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { parseArgs } from "@/scripts/enrich_city_pubs_tavily.mjs";
import {
  MAX_TAVILY_CREDITS_PER_RUN,
  runCityEnrichment,
  TAVILY_CREDITS_PER_SEARCH,
} from "@/scripts/lib/tavilyPubEnrichment.mjs";

const OBSERVED_AT = "2026-10-06T02:30:00.000Z";

function londonPubs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    osmId: `node/${i + 1}`,
    name: `Independent Arms ${i + 1}`,
    lat: 51.5,
    lng: -0.12,
    address: `${i + 1} Example Street, London, SW1A 1AA`,
    postcode: "SW1A 1AA",
    website: `https://independentarms${i + 1}.co.uk/`,
    operator: null,
    brewery: null,
  }));
}

function billing(credits: number) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ results: [], usage: { credits } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("the nightly London Tavily pass spends a bounded amount", () => {
  it("holds the cost at 200 searches, 400 credits and $3.20", () => {
    expect(TAVILY_CREDITS_PER_SEARCH).toBe(2);
    expect(MAX_TAVILY_CREDITS_PER_RUN).toBe(400);
    expect(MAX_TAVILY_CREDITS_PER_RUN * 0.008).toBeCloseTo(3.2, 10);
  });

  it("stops at 200 searches even when more pubs are due", async () => {
    const fetchImpl = billing(2);
    const result = await runCityEnrichment({
      city: "london",
      pubs: londonPubs(300),
      apiKey: "test-key",
      maxQueries: 5_000,
      maxCredits: 5_000,
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result.queriesSpent).toBe(200);
    expect(result.creditsSpent).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(200);
  });

  it("stops on credits before queries when the provider bills more per search", async () => {
    const fetchImpl = billing(5);
    const result = await runCityEnrichment({
      city: "london",
      pubs: londonPubs(300),
      apiKey: "test-key",
      observedAt: OBSERVED_AT,
      fetchImpl,
    });

    expect(result.creditsSpent).toBeLessThanOrEqual(MAX_TAVILY_CREDITS_PER_RUN);
    expect(result.queriesSpent).toBe(80);
  });

  it("lets a caller lower the credit ceiling and never raise it", async () => {
    const lowered = billing(2);
    const result = await runCityEnrichment({
      city: "london",
      pubs: londonPubs(50),
      apiKey: "test-key",
      maxCredits: 10,
      observedAt: OBSERVED_AT,
      fetchImpl: lowered,
    });

    expect(result.queriesSpent).toBe(5);
    expect(result.creditsSpent).toBe(10);
  });

  it("refuses a CLI ceiling above the code ceiling", () => {
    expect(parseArgs(["--city=london"])).toMatchObject({ maxQueries: 200, maxCredits: 400 });
    expect(() => parseArgs(["--city=london", "--max-credits=401"])).toThrow(/--max-credits/);
    expect(() => parseArgs(["--city=london", "--max-queries=201"])).toThrow(/--max-queries/);
    expect(parseArgs(["--city=london", "--max-credits=40"]).maxCredits).toBe(40);
  });
});

describe("the nightly London workflow", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github/workflows/tavily-london-nightly.yml"),
    "utf8",
  );

  it("runs the capped London pass on a schedule and by hand", () => {
    expect(workflow).toMatch(/schedule:\s*\n\s+- cron:/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("npm run enrich:city -- --city=london --max-queries=200 --max-credits=400");
  });

  it("serialises runs and never overlaps two nights' spend", () => {
    expect(workflow).toMatch(/concurrency:\s*\n\s+group:\s*tavily-london-nightly/);
    expect(workflow).toMatch(/cancel-in-progress:\s*false/);
  });

  it("opens a review PR and never pushes to the default branch", () => {
    expect(workflow).toContain("scripts/ci/with-git-token.sh scripts/ci/tavily-london-review-pr.sh");
    expect(workflow).not.toMatch(/git push[^\n]*\b(main|master)\b/);
    expect(workflow).toContain("persist-credentials: false");
  });

  it("validates the data before any PR opens", () => {
    expect(workflow.indexOf("npm run validate-data")).toBeGreaterThan(
      workflow.indexOf("npm run enrich:city"),
    );
    expect(workflow.indexOf("tavily-london-review-pr.sh")).toBeGreaterThan(
      workflow.indexOf("npm run validate-data"),
    );
  });

  it("saves the cursor even when a later step fails", () => {
    expect(workflow).toMatch(/Save the London cursor\s*\n\s+if: \$\{\{ !cancelled\(\) \}\}/);
  });

  it("pins every action to a commit", () => {
    for (const line of workflow.split("\n").filter((l) => l.includes("uses:"))) {
      expect(line).toMatch(/@[0-9a-f]{40}\b/);
    }
  });
});
