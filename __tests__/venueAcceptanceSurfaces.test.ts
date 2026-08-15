import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { VENUE_ACCEPTANCE_STORAGE_ERROR } from "@/lib/venueAcceptance";

function read(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

// The rule block for one class, so an assertion about "Keep" cannot be answered
// by some other rule further down the same stylesheet.
function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

const ACCEPTANCE_SURFACES = [
  ["app", "tonight", "TonightClient.tsx"],
  ["components", "nearme", "NearMeNow.tsx"],
  ["components", "PubMap.tsx"],
] as const;

describe("acceptance failure copy", () => {
  it("says pub, and never our own noun for a row", () => {
    expect(VENUE_ACCEPTANCE_STORAGE_ERROR).toContain("pub");
    expect(VENUE_ACCEPTANCE_STORAGE_ERROR).not.toMatch(/\bVenue\b/);
  });

  it("is one sentence with one owner, not three pasted copies", () => {
    // It was pasted into Near, Tonight and Map, and had already drifted from
    // the lowercase "Keep this venue" button beside it on the same screen.
    for (const parts of ACCEPTANCE_SURFACES) {
      const source = read(...parts);
      expect(source).toContain("VENUE_ACCEPTANCE_STORAGE_ERROR");
      expect(source).not.toContain("keep this Venue on this device");
      expect(source).not.toContain("keep this pub on this device");
    }
  });
});

describe("Keep affordance weight (captain decision D3)", () => {
  // The affordance stays on every row. It is not a filled coral button there:
  // a dozen listings meant a dozen primary actions, all as loud as the page's
  // own. Secondary weight uses the shared active-state tokens, the same ones
  // the grouped-alternate Keep already used.
  it("renders Tonight's row Keep at secondary weight, inside the card", () => {
    const css = read("app", "tonight", "tonight.css");
    const rule = ruleBlock(css, ".tonightRowAccept");

    expect(rule).toContain("var(--state-active-surface)");
    expect(rule).toContain("var(--state-active-border)");
    expect(rule).toContain("var(--state-active-ink)");
    expect(rule).not.toContain("var(--accent-action)");
    expect(rule).not.toContain("var(--color-on-accent)");
    // Not a full-width bar: it shrinks to its own words and clears the card edge.
    expect(rule).toContain("width: fit-content");
    expect(rule).toMatch(/min-height:\s*44px/);
  });

  it("renders Near's card Keep at the same secondary weight", () => {
    const css = read("components", "nearme", "nearMeNow.css");
    const rule = ruleBlock(css, ".nmnAccept");

    expect(rule).toContain("var(--state-active-surface)");
    expect(rule).toContain("var(--state-active-border)");
    expect(rule).toContain("var(--state-active-ink)");
    expect(rule).not.toContain("var(--accent-action)");
    expect(rule).toMatch(/min-height:\s*44px/);
  });

  it("keeps Tonight's two Keep buttons reading as one action", () => {
    const css = read("app", "tonight", "tonight.css");
    const nested = read("app", "tonight", "tonightDedup.css");
    const row = ruleBlock(css, ".tonightRowAccept");
    const alternate = ruleBlock(nested, ".tonightRowMoreAccept");

    for (const token of [
      "var(--state-active-surface)",
      "var(--state-active-border)",
      "var(--state-active-ink)",
    ]) {
      expect(row).toContain(token);
      expect(alternate).toContain(token);
    }
  });
});
