import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Reddit harvest fixture boundary", () => {
  it("preserves existing evidence and report artifacts when all sources are refused", () => {
    const files = ["data/community_price_observations/london_reddit.json", "public/data/community_price_observations/london_reddit.json", "data/review/reddit_london_prices_report.json"];
    const contents = () => files.map((file) => existsSync(file) ? readFileSync(file, "utf8") : null);
    const before = contents();
    const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/harvest_reddit_london_prices.mjs", "--limit", "1"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 20_000,
      env: { ...process.env, TYPESAFE_API_KEY: "", TAVILY_API_KEY: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("existing evidence pack retained");
    expect(JSON.parse(result.stdout).spend).toEqual({ tavily: 0, typesafe: 0 });
    expect(contents()).toEqual(before);
  });
  it("exercises valid evidence without publishing synthetic fixture rows", () => {
    const files = ["data/community_price_observations/london_reddit.json", "public/data/community_price_observations/london_reddit.json", "data/review/reddit_london_prices_report.json"];
    const contents = () => files.map((file) => existsSync(file) ? readFileSync(file, "utf8") : null);
    const before = contents();
    const report = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/harvest_reddit_london_prices.mjs", "--from-fixture"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 20_000,
      env: { ...process.env, TYPESAFE_API_KEY: "", TAVILY_API_KEY: "" },
    }));
    expect(report.landed).toBeGreaterThan(0);
    expect(report.spend).toEqual({ tavily: 0, typesafe: 0 });
    expect(contents()).toEqual(before);
  });
});
