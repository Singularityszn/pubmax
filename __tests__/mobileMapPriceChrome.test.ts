import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
const mobileShell = readFileSync(
  join(process.cwd(), "components/mobile/MobileMapShell.tsx"),
  "utf8",
);
const mobileCss = readFileSync(
  join(process.cwd(), "components/mobile/mobileMapShell.css"),
  "utf8",
);
const priceControl = readFileSync(
  join(process.cwd(), "components/map/MapPriceControl.tsx"),
  "utf8",
);
const priceCss = readFileSync(
  join(process.cwd(), "components/map/mapPriceControl.css"),
  "utf8",
);
const conciergeCss = readFileSync(
  join(process.cwd(), "components/map/mapConciergeAsk.css"),
  "utf8",
);

describe("mobile map price chrome", () => {
  it("puts the complete key in the existing More sheet", () => {
    expect(pubMap).toContain('useState<"key" | "layers" | "prices" | "events" | "transit">("key")');
    expect(pubMap).toContain('<TabsTrigger value="key">Key</TabsTrigger>');
    expect(pubMap).toContain('<TabsContent value="key"');
    expect(pubMap).toContain("<MapKey");
    expect(mobileShell).toContain('layers: "Map controls"');
    expect(pubMap).toContain('className="mobileMapControlTabs"');
    expect(mobileCss).toMatch(
      /\.mobileMapControlTabs\s*>\s*\[role="tab"\]\s*{[\s\S]*?flex:\s*1[\s\S]*?min-width:\s*0/,
    );
  });

  it("adds no phone top-chrome control for the key", () => {
    expect(mobileShell).not.toContain("MapPriceControl");
    expect(mobileShell.match(/aria-label="More map controls"/g)).toHaveLength(1);
    expect(priceCss).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.mapPriceControl--map\s*{\s*display:\s*none/);
  });

  it("keeps the remaining bottom actions clear of primary navigation", () => {
    expect(conciergeCss).toContain(
      "bottom: calc(var(--mobile-tab-clearance, 72px) + 28px)",
    );
  });
});
