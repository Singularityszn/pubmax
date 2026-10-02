// "Confirmed" MEANS ONE THING (battle test L03).
//
// A third confirmation vocabulary shipped beside the two the trust projection
// knows. `POST /api/price-confirm` took an anonymous body, counted it by hashed
// IP, and the chip above it printed "Confirmed - 1 confirm." beside a price the
// trust chip on the same sheet called logged-once. It was optimistic, fail-soft
// and reachable by a script but not by a finger, and its tally rode into the
// fact-claim model as a `community` publisher that upgraded a lone scraped
// baseline to `corroborated`.
//
// FIRSTMATE'S CHOICE, of the two offered: RETIRE IT, not fold it in. Folding
// was never open. Independence in this tree is an authority key derived from a
// verified account (ADR 0010, migration 0117), and an IP is a household, a
// pub's own wifi and a mobile carrier's NAT. A lane that cannot say how many
// PEOPLE stood behind a price cannot be given a word that means exactly that.
//
// The interaction survives where it can be trusted: `Still £4.50?` on the venue
// Overview (lib/pintDropSecondDrinker.ts) asks a signed-in drinker for a dated
// Pint Drop carrying a key, and `It's changed` on the Golden Thread opens the
// same composer.
//
// The TABLE is left alone. `price_confirms` (migration 0025) holds rows real
// people tapped, and dropping data is not what retiring a reading means. It is
// simply no longer read.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SWEPT_DIRS = ["app", "components", "lib"];
const CODE = /\.(ts|tsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE.test(entry)) out.push(full);
  }
  return out;
}

const FILES = SWEPT_DIRS.filter((dir) => existsSync(join(ROOT, dir))).flatMap((dir) =>
  walk(join(ROOT, dir)),
);

/** Source with comments stripped, so a note ABOUT the retirement is not an offence. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("the anonymous price-confirm lane is retired", () => {
  it("has no route", () => {
    expect(existsSync(join(ROOT, "app/api/price-confirm/route.ts"))).toBe(false);
  });

  it("has no store", () => {
    expect(existsSync(join(ROOT, "lib/priceConfirmStore.ts"))).toBe(false);
  });

  it("is called by nothing", () => {
    const callers = FILES.filter((file) => /\/api\/price-confirm/.test(code(file)));
    expect(callers.map((file) => file.replace(`${ROOT}/`, ""))).toEqual([]);
  });

  it("is imported by nothing", () => {
    const importers = FILES.filter((file) => /priceConfirmStore/.test(code(file)));
    expect(importers.map((file) => file.replace(`${ROOT}/`, ""))).toEqual([]);
  });

  it("leaves no vouch publisher in the fact-claim signals", () => {
    expect(existsSync(join(ROOT, "lib/priceFactClaims.ts"))).toBe(false);
  });

  it("leaves no vouch wording in the confidence read", () => {
    // "×3 this week", "vouched this week", "vouched recently" all described an
    // anonymous tally as though it counted people.
    const source = code(join(ROOT, "lib/priceConfidence.ts"));
    for (const word of ["vouched", "this week"]) {
      expect(source, `"${word}" is retired copy`).not.toContain(word);
    }
    // The module still exists and still answers an honest age question.
    expect(source).toContain("priceObservedAt");
  });

  it("keeps the migration that created the table, because rows are not read state", () => {
    // Retiring a reading is not the same as deleting what people did. The table
    // stays; nothing reads it.
    expect(
      existsSync(join(ROOT, "supabase/migrations/20260712130424_0025_price_confirms.sql")),
    ).toBe(true);
  });
});

describe("the surviving door", () => {
  const path = join(ROOT, "components/map/VenuePriceStory.tsx");

  it("is the correction path into the Pint Drop composer", () => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("It&rsquo;s changed");
    expect(source).toContain("onPriceChanged");
  });

  it("is a plain control, not the retired optimistic chip", () => {
    expect(code(path)).not.toContain("Confirmed just now");
  });
});
