import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Signed-in QA F26: small targets and a pale-pink destructive label on cream.
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("signed-in accessibility sweep", () => {
  it("reaches 44px of hit area on the report pills without growing them", () => {
    const globals = read("app/globals.css");
    expect(globals).toMatch(/\.reportBtn::after \{[^}]*inset: -11px -6px/);
    expect(read("app/messages/messages.css")).toMatch(/\.messageReportBtn::after \{[^}]*inset: -6px -4px/);
  });

  it("gives the walking route link 44px and keeps the layout", () => {
    expect(read("app/plan/plan.css")).toMatch(
      /\.planRoute__walk \{[^}]*padding-block: 14px;[^}]*margin: 8px 0 -18px 72px/,
    );
  });

  it("stretches the founders handle link over its row", () => {
    expect(read("app/founders/founders.css")).toMatch(/\.foundersHandle::after \{[^}]*inset: 0/);
  });

  it("colours the destructive Pal action from the theme token, not a fixed pink", () => {
    const pal = read("app/pal/pal.css");
    expect(pal).not.toContain("#ffb1bc !important");
    expect(pal).toMatch(/\.palDanger \{[^}]*var\(--tint-ink-negative/);
  });
});
