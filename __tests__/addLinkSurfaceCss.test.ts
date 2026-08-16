import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/add/[handle]/add.css"), "utf8");

function rule(selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]+)\\}`));
  expect(match, `${selector} must exist`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("add-link card chrome", () => {
  it("paints the initials fallback as a 56px circle", () => {
    const block = rule("\\.confirmFollowAvatar");
    expect(block).toMatch(/width:\s*56px/);
    expect(block).toMatch(/height:\s*56px/);
    expect(block).toMatch(/border-radius:\s*50%/);
  });

  it("gives the primary CTA the same horizontal padding as the secondary", () => {
    expect(rule("\\.confirmFollowPrimary")).toMatch(/padding:\s*0 18px/);
    expect(rule("\\.confirmFollowSecondary")).toMatch(/padding:\s*0 18px/);
  });
});
