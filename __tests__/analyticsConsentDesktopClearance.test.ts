import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const globalCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const mobileMapCss = readFileSync(
  join(process.cwd(), "components/mobile/mobileMapShell.css"),
  "utf8",
);

describe("analytics consent desktop clearance", () => {
  it("reserves body foot room while the fixed consent bar is mounted", () => {
    expect(globalCss).toMatch(
      /@media \(min-width:\s*641px\)\s*{[^}]*body:has\(\.analyticsConsentPrompt\)\s*{[^}]*padding-bottom:\s*calc\(\s*var\(--analytics-consent-clearance,\s*72px\)/,
    );
    expect(globalCss).toMatch(
      /body:has\(\.analyticsConsentPrompt\)\s*{[^}]*max\(12px,\s*env\(safe-area-inset-bottom\)\)/,
    );
  });

  it("keeps the consent prompt on a fixed bottom layer", () => {
    expect(globalCss).toMatch(
      /\.analyticsConsentPrompt\s*{[^}]*position:\s*fixed/,
    );
  });

  it("keeps the full disclosure visible on the map", () => {
    const mapParagraph = globalCss.match(
      /body:has\(\.mobilePlanActivation\) \.analyticsConsentPrompt p\s*{([^}]*)}/,
    )?.[1] ?? "";
    expect(mapParagraph).not.toMatch(/line-clamp|overflow:\s*hidden/);
    expect(mobileMapCss).toMatch(
      /body:has\(\.analyticsConsentPrompt\) \.appShell \.mapStage \.maplibregl-ctrl-bottom-right\s*{[^}]*202px/,
    );
  });
});
