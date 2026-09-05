import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// A nearby distance is printed by the ONE shared formatter, and its
// straight-line caveat is said once in the section head rather than on every
// row. The landmark story body owns the rows now (it used to be an aside inside
// PubMapCanvas); the chapter page prints the same rows through the same call.
const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

describe("landmark story nearby distance contract", () => {
  it.each(["components/map/LandmarkStoryBody.tsx", "app/landmark/[id]/page.tsx"])(
    "%s uses the shared nearby distance formatter and the shared caveat",
    (file) => {
      const source = read(file);
      expect(source).toMatch(
        /import\s*\{[\s\S]*?formatLogNearbyDistance[\s\S]*?\}\s*from\s*["']@\/lib\/mapLogIntent["']/,
      );
      expect(source).not.toMatch(/km\s*<\s*1\s*\?\s*`\$\{Math\.round\(km\s*\*\s*1000\)/);
      expect(source).not.toMatch(/toFixed\(\d\)\}?\s*km/);
      expect(source).toContain("STORY_PUBS_DISTANCE_CAVEAT");
      // The caveat is not restated beside a figure.
      expect(source).not.toMatch(/straight-line/i);
    },
  );

  it("the canvas no longer prints a distance of its own", () => {
    const source = read("components/PubMapCanvas.tsx");
    expect(source).not.toContain("formatLogNearbyDistance");
    expect(source).not.toContain("landmarkCard");
  });
});
