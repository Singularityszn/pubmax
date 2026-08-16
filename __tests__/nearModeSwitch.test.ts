import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NearModeSwitch from "@/components/nearme/NearModeSwitch";
import { resolveNearMode } from "@/lib/nearDesk";

describe("NearModeSwitch", () => {
  it("renders a radiogroup with Pint and Desk", () => {
    const html = renderToStaticMarkup(
      createElement(NearModeSwitch, { value: "pint", onChange: vi.fn() }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Near mode"');
    expect(html).toContain('role="radio"');
    expect(html).toContain("Pint");
    expect(html).toContain("Desk");
    expect(html).toMatch(/aria-checked="true"/);
    expect(html).toMatch(/aria-checked="false"/);
  });

  it("marks Desk checked when that mode is active", () => {
    const html = renderToStaticMarkup(
      createElement(NearModeSwitch, { value: "desk", onChange: vi.fn() }),
    );
    expect(html).toMatch(/aria-checked="true"[^>]*>Desk/);
  });
});

describe("pint mode default", () => {
  it("answers pint when no param and nothing remembered", () => {
    expect(resolveNearMode(null, null)).toBe("pint");
    expect(resolveNearMode("pint", "desk")).toBe("pint");
  });
});
