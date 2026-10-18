import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Round board (app/rounds/[code]/round.css) predated the launch rules: six
 * tracked all-caps labels, 10px and 11px type, a coral disc on every stop and
 * coral handle links. docs/DESIGN_SYSTEM.md: caps are for stamps only, coral
 * fills the one primary and the create disc, and the stop the crew is at now
 * is the "you are here" marker.
 */

const css = readFileSync(join(process.cwd(), "app/rounds/[code]/round.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is styled`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

describe("the Round board", () => {
  it("sets no label in caps", () => {
    expect(css).not.toMatch(/text-transform\s*:\s*uppercase/);
  });

  it("sets no type below the scale", () => {
    expect(css).not.toMatch(/font-size\s*:\s*1[01]px/);
  });

  it("numbers stops in ink and marks the current one as where the crew is", () => {
    expect(rule(".roundStopNumber")).not.toMatch(/var\(--brass\)/);
    expect(rule(".roundStopNow .roundStopNumber")).toContain("var(--state-active-border)");
  });

  it("spends no coral on a handle", () => {
    expect(rule(".roundHostTag")).not.toMatch(/var\(--brass\)/);
    expect(rule(".roundMemberChip a")).toContain("min-height: 44px");
  });
});
