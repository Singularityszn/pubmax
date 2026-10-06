import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The 390px tap-target floor (44px) for the controls the signed-out sweep
// measured under it. The browser proof is e2e/tap-targets-sweep.spec.ts; these
// pins hold the CSS that gives it so a refactor cannot quietly drop one.

function rule(file: string, selector: string): string {
  const css = readFileSync(join(process.cwd(), file), "utf8");
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} in ${file}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("44px tap targets", () => {
  it("lifts the Historic borough link without growing its card", () => {
    const body = rule("app/historic/historic.css", ".historicBoroughLink");
    expect(body).toMatch(/padding-block:\s*13px/);
    expect(body).toMatch(/margin-block:\s*-13px/);
  });

  it("lifts the Spoons value pub link without growing the row", () => {
    const body = rule("app/spoons-value/spoons-value.css", ".spoonsTablePub a");
    expect(body).toMatch(/padding-block:\s*15px/);
    expect(body).toMatch(/margin-block:\s*-15px/);
  });

  it("lifts the Run this pub trigger without growing the row", () => {
    const body = rule("components/operators/operatorRail.css", ".operatorRailTrigger");
    expect(body).toMatch(/padding:\s*10px 0/);
    expect(body).toMatch(/margin:\s*-10px 0/);
  });

  it("gives the Drink Wall chips and scope buttons the 44px floor", () => {
    expect(rule("components/drink-wall/drinkWall.css", ".drinkWallTag")).toMatch(/min-height:\s*44px/);
    expect(rule("components/drink-wall/drinkWall.css", ".drinkWallTag")).toMatch(/min-width:\s*44px/);
    expect(rule("components/drink-wall/drinkWall.css", ".drinkWallScope button")).toMatch(
      /min-height:\s*44px/,
    );
  });

  it("lifts the ledger masthead link without moving the masthead", () => {
    const body = rule("app/ledger/[id]/ledger.css", ".ledgerHomeLink");
    expect(body).toMatch(/padding-block:\s*10px/);
    expect(body).toMatch(/margin-top:\s*-10px/);
    expect(body).toMatch(/margin-bottom:\s*8px/);
  });

  it("stretches the Places search input to its field", () => {
    expect(rule("app/places/places.css", ".placesSearchInput")).toMatch(/align-self:\s*stretch/);
  });
});
