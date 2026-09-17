import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatGbp } from "@/lib/formatGbp";
import { formatSightingPrice } from "@/lib/feedSightings";
import { priceStamp } from "@/lib/ogBrand";
import { formatPlanInviteSpendBand } from "@/lib/shareArtifacts";
import { formatZoneGbp } from "@/lib/zones";

const ROOT = process.cwd();

// Named GBP copies from #1412. Each must spend formatGbp rather than restating
// `£${value.toFixed(2)}`. Wrappers may still own null/placeholder policy.
const FORMAT_GBP_CALLERS = [
  "lib/feedSightings.ts",
  "lib/shareArtifacts.ts",
  "lib/ogBrand.tsx",
  "components/landing/PintDropStrip.tsx",
  "app/p/[id]/opengraph-image.tsx",
  "lib/zones.ts",
  "lib/quietPint.ts",
  "lib/planningAnchor.server.ts",
] as const;

describe("formatGbp — canonical GBP string", () => {
  it("prints two decimal places with a leading pound", () => {
    expect(formatGbp(5.4)).toBe("£5.40");
    expect(formatGbp(12)).toBe("£12.00");
    expect(formatGbp(0)).toBe("£0.00");
  });

  it("is the string the named wrappers print for a finite price", () => {
    expect(formatSightingPrice(5.4)).toBe(formatGbp(5.4));
    expect(formatZoneGbp(5.4)).toBe(formatGbp(5.4));
    expect(priceStamp(5.4)).toBe(formatGbp(5.4));
    expect(formatPlanInviteSpendBand({ minGbp: 5.4, maxGbp: 5.4 })).toBe(
      `${formatGbp(5.4)} per person`,
    );
  });

  it("is imported by every named GBP copy from #1412", () => {
    const missing: string[] = [];
    for (const file of FORMAT_GBP_CALLERS) {
      const source = readFileSync(join(ROOT, file), "utf8");
      const spendsCanonical =
        source.includes('from "@/lib/formatGbp"') ||
        source.includes("from '@/lib/formatGbp'") ||
        (file === "app/p/[id]/opengraph-image.tsx" &&
          source.includes("priceStamp") &&
          source.includes('from "@/lib/ogBrand"'));
      if (!spendsCanonical) missing.push(file);
      expect(source, `${file} must not restate the pound toFixed formula`).not.toMatch(
        /£\$\{[^}]*toFixed\(2\)\}/,
      );
    }
    expect(missing).toEqual([]);
  });
});
