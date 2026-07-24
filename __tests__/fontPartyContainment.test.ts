import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Party-accent containment gate (docs/VIBE_LAYER_SPEC_2026-07-19.md, "Accent
// type"): Bungee is QUARANTINED — at most three component families may
// reference var(--font-party), and it must never reach body, navigation, or
// data surfaces. This test greps the tracked tree so a leak fails CI the
// moment a fourth family (or a banned surface) adopts the token.

// Files allowed to mention --font-party without counting as consumers:
// the token's definition sites. Docs and this test never count — the grep
// below is scoped to code surfaces, so prose can name the token freely.
const DEFINITION_SITES = new Set([
  "app/layout.tsx",
  "app/globals.css",
  // Route-scoped definition of the token (the next/font module loaded only by
  // /tonight and /pal). It defines --font-party, it does not consume it.
  "app/fonts/partyFace.ts",
]);

// Surfaces the spec bans outright — a --font-party reference here is a leak
// regardless of the family budget.
const BANNED_PREFIXES = [
  "components/nav/",
  "components/landing/",
  "app/pint-index",
  "app/discover",
];

function trackedFilesReferencingToken(): string[] {
  // Scoped to code surfaces on purpose: only code can leak the accent onto a
  // banned surface, and docs referencing the token by name must not trip the
  // family budget (a handoff note once turned main red exactly this way).
  const out = execFileSync(
    "git",
    ["grep", "-l", "--", "--font-party", "app", "components", "lib"],
    { encoding: "utf8", cwd: process.cwd() },
  );
  return out.split("\n").filter(Boolean);
}

// A "component family" is the directory under components/ (or the app route
// segment) that owns the file — the unit the spec budgets.
function familyOf(file: string): string {
  const parts = file.split("/");
  if (parts[0] === "components") return parts.slice(0, 2).join("/");
  if (parts[0] === "app") return parts.slice(0, 2).join("/");
  return file;
}

describe("party accent containment (vibe layer spec)", () => {
  it("keeps var(--font-party) inside the quarantine", () => {
    const files = trackedFilesReferencingToken();
    const consumers = files.filter((file) => !DEFINITION_SITES.has(file));

    for (const file of consumers) {
      for (const banned of BANNED_PREFIXES) {
        expect(
          file.startsWith(banned),
          `--font-party leaked into banned surface ${file}`,
        ).toBe(false);
      }
    }

    const families = new Set(consumers.map(familyOf));
    expect(
      families.size,
      `--font-party referenced by ${families.size} component families (${[...families].join(", ")}); spec caps it at 3`,
    ).toBeLessThanOrEqual(3);
  });

  it("keeps the killed register out of the tracked tree's product strings", () => {
    // Spec kill-list: these terms are banned everywhere, not just chips.
    // git grep -w keeps this honest (no substring hits inside larger words).
    // lib/vibeChips.ts is the kill-list's one canonical DEFINITION site (its
    // KILLED_VIBE_TERMS constant powers the chip-surface tests) — the terms
    // appearing there are the ban itself, not product copy, so it is the one
    // sanctioned hit. Anything else is a leak.
    const KILL_LIST_DEFINITION_SITE = "lib/vibeChips.ts";
    for (const term of ["turnt", "bussin"]) {
      let hits = "";
      try {
        hits = execFileSync(
          "git",
          ["grep", "-liw", "--", term, "components", "app", "lib"],
          { encoding: "utf8", cwd: process.cwd() },
        );
      } catch {
        // git grep exits 1 on zero matches — the passing case.
      }
      const leaks = hits
        .split("\n")
        .filter(Boolean)
        .filter((file) => file !== KILL_LIST_DEFINITION_SITE);
      expect(leaks, `killed term "${term}" found`).toEqual([]);
    }
  });
});
