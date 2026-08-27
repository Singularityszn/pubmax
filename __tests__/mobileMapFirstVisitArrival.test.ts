import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const mobileMapShellCss = readFileSync(
  resolve(process.cwd(), "components/mobile/mobileMapShell.css"),
  "utf8",
);
const mobileNavCss = readFileSync(
  resolve(process.cwd(), "components/nav/mobileNav.css"),
  "utf8",
);
const mobileMapShellSource = readFileSync(
  resolve(process.cwd(), "components/mobile/MobileMapShell.tsx"),
  "utf8",
);
const pubMapSource = readFileSync(
  resolve(process.cwd(), "components/PubMap.tsx"),
  "utf8",
);
const pubMapCanvasSource = readFileSync(
  resolve(process.cwd(), "components/PubMapCanvas.tsx"),
  "utf8",
);

const firstVisitHideBlock =
  mobileMapShellCss.match(
    /body:has\(\.mapArrivalCard\) \.mobileMapUtilityCorner,[\s\S]*?display:\s*none;/,
  )?.[0] ?? "";
const firstVisitTabBarHideBlock =
  mobileNavCss.match(
    /body:has\(\.mapStage\):has\(\.mapArrivalCard\) \.mobileTabBar\s*\{[\s\S]*?\}/,
  )?.[0] ?? "";

describe("mobile map first-visit presentation", () => {
  it("leaves only the top bar and First visit card", () => {
    expect(firstVisitHideBlock, "First visit hide block present").not.toBe("");
    expect(firstVisitHideBlock).toContain(".mobileMapChipRow");
    expect(firstVisitHideBlock).toContain(".mobilePlanActivation");
    expect(firstVisitHideBlock).toContain(".mobileMapUtilityCorner");
    expect(firstVisitHideBlock).toMatch(/display:\s*none/);
  });

  it("hides primary navigation until the arrival choice", () => {
    expect(firstVisitTabBarHideBlock, "First visit tab bar rule present").not.toBe("");
    expect(firstVisitTabBarHideBlock).toMatch(/opacity:\s*0/);
    expect(firstVisitTabBarHideBlock).toMatch(/pointer-events:\s*none/);
    expect(firstVisitTabBarHideBlock).toMatch(/visibility:\s*hidden/);
    expect(firstVisitTabBarHideBlock).toMatch(/transform:\s*translateY\(110%\)/);
  });

  it("locks map and chrome interaction until the arrival choice", () => {
    expect(pubMapSource).toMatch(
      /<PubMapCanvas[\s\S]*?interactionLocked=\{mobileViewport && showMapArrivalCard\}/,
    );
    expect(pubMapSource).toMatch(
      /<MobileMapShell[\s\S]*?interactionLocked=\{showMapArrivalCard\}/,
    );
    expect(pubMapCanvasSource).toMatch(
      /className="mapCanvasWrap"[\s\S]*?inert=\{interactionLocked \|\| undefined\}/,
    );
    expect(mobileMapShellSource).toMatch(
      /className="mobileMapChrome"[\s\S]*?inert=\{interactionLocked \|\| undefined\}/,
    );
  });
});
