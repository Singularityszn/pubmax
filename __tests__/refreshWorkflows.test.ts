import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflow = (name: string) =>
  readFileSync(join(root, ".github", "workflows", name), "utf8");

describe("refresh workflow contracts", () => {
  it("runs London pint prices Monday and opens a review PR", () => {
    const source = workflow("drink-price-refresh.yml");
    expect(source).toMatch(/^  schedule:\n(?:    #.*\n)*    - cron: "30 7 \* \* 1"/m);
    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("node scripts/refresh_drink_prices.mjs --open-pr");
  });

  it("runs London events daily and declares both provider keys", () => {
    const source = workflow("events-refresh.yml");
    expect(source).toMatch(/^  schedule:\n(?:    #.*\n)*    - cron: "45 15 \* \* \*"/m);
    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("TICKETMASTER_API_KEY: ${{ secrets.TICKETMASTER_API_KEY }}");
    expect(source).toContain("SKIDDLE_API_KEY: ${{ secrets.SKIDDLE_API_KEY }}");
    expect(source).toContain("npm run refresh:events -- --open-pr");
  });

  it("keeps weather on its existing daily schedule", () => {
    const source = workflow("weather-refresh.yml");
    expect(source).toContain('cron: "15 14 * * *"');
  });
});
