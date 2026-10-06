// TWO LISTS OF HOSTS WE MAY NOT READ, AND THEY HAVE TO SAY THE SAME THING.
//
// lib/harvest/sourcePolicy.ts names the refused Mitchells & Butlers brand
// domains; scripts/build_price_estimate_baselines.mjs restates them because it
// is a plain-node CLI that cannot import TypeScript. Its own comment already
// promised a fence held the two in step, and there was none. This is it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REFUSED_ESTATE_HOSTS, isHarvestableOperatorUrl } from "@/lib/harvest/sourcePolicy";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = join(__dirname, "..");

function literalListIn(file: string, name: string): string[] {
  const source = readFileSync(join(ROOT, file), "utf8");
  const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(source);
  if (!match) throw new Error(`${file} no longer declares ${name}`);
  return [...defined(match[1]).matchAll(/"([^"]+)"/g)].map((row) => defined(row[1])).sort();
}

describe("the hosts a refused estate publishes on", () => {
  it("is the same set in the policy table and in the estimate baseline builder", () => {
    const builder = literalListIn("scripts/build_price_estimate_baselines.mjs", "REFUSED_HOSTS");
    // The builder's list also carries the estate's own flagship host, which the
    // policy table holds as a source row rather than as a brand domain.
    const policy = [...REFUSED_ESTATE_HOSTS, "nicholsonspubs.co.uk"].sort();
    expect(builder).toEqual(policy);
  });

  it("stops a refused brand domain arriving wearing one pub's own name", () => {
    for (const host of REFUSED_ESTATE_HOSTS) {
      expect(isHarvestableOperatorUrl(`https://www.${host}/pubs/somewhere`), host).toBe(false);
    }
  });

  it("still admits an ordinary pub's own site", () => {
    expect(isHarvestableOperatorUrl("https://www.edinborocastlepub.co.uk/")).toBe(true);
  });
});
