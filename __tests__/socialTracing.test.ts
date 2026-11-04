import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listEnabledCities } from "@/lib/cities";
import registry from "@/data/freshness_registry.json";

const root = join(__dirname, "..");

function tracingIncludes(): Record<string, string[]> {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import(process.argv[1]);" +
        "console.log(JSON.stringify(m.default.outputFileTracingIncludes ?? null));",
      join(root, "next.config.mjs"),
    ],
    { cwd: root, encoding: "utf8" },
  );
  return JSON.parse(output) as Record<string, string[]>;
}

describe("Social data-file tracing", () => {
  it("ships the public discovery packs and the empty lane's attributed menu observations", () => {
    const files = tracingIncludes()["/social"];
    const expected = listEnabledCities().map(
      (city) => `./public${city.slimVenuesPath}`,
    );
    for (const id of ["drink_price_updates", "food_price_updates"]) {
      const artifact = registry.datasets.find((dataset) => dataset.id === id)?.artifact;
      expect(artifact).toBeTruthy();
      expected.push(`./${artifact}`);
    }
    expected.push("./public/data/pint_prices_app_dataset.json", "./public/data/uk_prices/rows.json", "./data/generated/uk_pub_search.json");
    // The UK bundle resolves former venue IDs through all three alias packs.
    expected.push(
      "./public/data/venue_id_aliases.json",
      "./public/data/cities/venue_id_aliases.json",
      "./public/data/uk_base_venue_id_aliases.json",
    );
    expect(new Set(files)).toEqual(new Set(expected));
  });
});
