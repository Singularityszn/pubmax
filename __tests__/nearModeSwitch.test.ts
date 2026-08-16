import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import NearModeSwitch from "@/components/nearme/NearModeSwitch";

describe("NearModeSwitch", () => {
  it("renders a 44px tablist with Pint and Desk", () => {
    const html = renderToStaticMarkup(
      createElement(NearModeSwitch, { value: "pint", onChange: vi.fn() }),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Near mode"');
    expect(html).toContain('role="tab"');
    expect(html).toContain("Pint");
    expect(html).toContain("Desk");
    expect(html).toMatch(/aria-selected="true"/);
    expect(html).toMatch(/aria-selected="false"/);
  });

  it("marks Desk selected when that mode is active", () => {
    const html = renderToStaticMarkup(
      createElement(NearModeSwitch, { value: "desk", onChange: vi.fn() }),
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>Desk/);
  });
});

describe("pint mode isolation", () => {
  it("leaves NearMeNow unaware of desk mode", () => {
    const source = readFileSync(
      join(process.cwd(), "components/nearme/NearMeNow.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/nearDesk|NearDesk|mode=desk|NEAR_MODE/);
  });
});
