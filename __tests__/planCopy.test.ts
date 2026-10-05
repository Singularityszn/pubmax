import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The Plan route makes three to six Stops. Any head that names a count must
// name the whole range; "three useful stops" once promised the floor as the
// ceiling. The describe-first Screen owns the /plan head now, and the map
// sheet's planner carries its own.
const heads = [
  "app/plan/page.tsx",
  "components/plan/PlanDescribeFirst.tsx",
  "components/plan/MobilePlanActivation.tsx",
];

describe("Plan head copy", () => {
  for (const file of heads) {
    it(`${file} never narrows the route to three stops`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/three useful stops/i);
      for (const claim of source.match(/\b(three|3)[^.\n]{0,24}stops\b/gi) ?? []) {
        expect(claim).toMatch(/three to six|3 to 6/i);
      }
    });
  }
});
