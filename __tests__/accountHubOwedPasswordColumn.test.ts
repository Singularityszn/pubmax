import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Spanning the whole row left an empty right column beside the private details
// before a password existed.
describe("account hub owed password card", () => {
  const css = readFileSync(join(process.cwd(), "app/u/[handle]/profile.css"), "utf8");
  const line = css.split("\n").find((l) => l.startsWith(".accountHubGrid .accountHubPasswordOwed"));

  it("keeps its brass border and takes a grid column of its own", () => {
    expect(line).toBeDefined();
    expect(line).toContain("var(--brass)");
    expect(line).not.toContain("grid-column");
  });
});

// The name and actions straddle the cover's lower edge. A busy photograph under
// them read as noise because the falloff only reached 72 percent of the panel.
describe("profile cover scrim", () => {
  const css = readFileSync(join(process.cwd(), "app/u/[handle]/profile.css"), "utf8");
  const start = css.indexOf(".profilePage .profileCoverFalloff");
  const block = css.slice(start, css.indexOf("}", start));

  it("is nearly opaque at the cover's foot", () => {
    expect(block).toMatch(/var\(--panel-raised\) 96%, transparent\) 100%/);
  });
});
