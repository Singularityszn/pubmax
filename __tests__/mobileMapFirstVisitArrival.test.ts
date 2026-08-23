import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const mobileMapShellCss = readFileSync(
  resolve(process.cwd(), "components/mobile/mobileMapShell.css"),
  "utf8",
);

const VIEWPORTS = [320, 390, 430] as const;
const firstVisitHideBlock =
  mobileMapShellCss.match(
    /body:has\(\.mapArrivalCard\) \.mobileMapUtilityCorner,[\s\S]*?display:\s*none;/,
  )?.[0] ?? "";

describe("mobile map first-visit presentation", () => {
  for (const viewport of VIEWPORTS) {
    it(`${viewport}px leaves only the top bar and First visit card`, () => {
      expect(firstVisitHideBlock, "First visit hide block present").not.toBe("");
      expect(firstVisitHideBlock).toContain(".mobileMapChipRow");
      expect(firstVisitHideBlock).toContain(".mobilePlanActivation");
      expect(firstVisitHideBlock).toContain(".mobileMapUtilityCorner");
      expect(firstVisitHideBlock).toMatch(/display:\s*none/);
    });
  }
});
