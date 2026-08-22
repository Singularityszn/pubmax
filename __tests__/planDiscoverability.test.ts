import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const LANDING = path.join(__dirname, "..", "components", "landing", "LandingPage.tsx");
const PLAN_INTAKE = path.join(__dirname, "..", "components", "plan", "PlanIntake.tsx");

function landingCopy(): string {
  return readFileSync(LANDING, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
}

describe("Lane H plan discoverability", () => {
  const landing = landingCopy();
  const planIntake = readFileSync(PLAN_INTAKE, "utf8");

  it("keeps a primary hero CTA on /plan for planning with mates", () => {
    expect(landing).toMatch(/className="lpButton lpButtonPrimary"[\s\S]*href="\/plan"[\s\S]*Plan tonight together/);
    expect(landing).toContain('href="/plan"');
    expect(landing).toContain("Plan tonight together");
  });

  it("exposes Plan in the landing primary nav", () => {
    expect(landing).toMatch(/lpPrimaryNav[\s\S]*href="\/plan"[\s\S]*>Plan</);
  });

  it("does not bury Plan only behind the map in the final CTA", () => {
    const finalBlock = landing.match(/lpFinalCta[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(finalBlock).toMatch(/href="\/plan"/);
    expect(finalBlock).toContain("Plan tonight together");
  });

  it("routes the Pub Pal callout to the ask surface, not back to Plan", () => {
    expect(landing).toMatch(/lpPalCallout[\s\S]*href="\/pal\/chat"/);
    expect(landing).toContain("Ask your Pub Pal");
    const callout = landing.match(/lpPalCallout[\s\S]*?<\/div>\s*<\/section>/)?.[0] ?? "";
    expect(callout).not.toMatch(/href="\/plan"/);
  });

  it("offers Pub Pal as an alternate entry on the plan intake surface", () => {
    expect(planIntake).toContain('href="/pal/chat"');
    expect(planIntake).toContain("Not sure?");
    expect(planIntake).toContain("Ask your Pub Pal…");
    expect(planIntake).toContain("planIntake__palEntry");
  });
});
