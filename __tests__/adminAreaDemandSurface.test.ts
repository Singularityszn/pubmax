import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

describe("coverage demand admin surface", () => {
  it("starts with one clear load action and no contact-data contract", async () => {
    const { default: CoverageDemandQueue } =
      await import("@/app/admin/CoverageDemandQueue");
    const markup = renderToStaticMarkup(
      createElement(CoverageDemandQueue, {
        ensureAdminSession: vi.fn(async () => true),
        retryWithFreshSession: vi.fn(async (request) => request()),
      }),
    );
    const source = readFileSync("app/admin/CoverageDemandQueue.tsx", "utf8");
    const css = readFileSync("app/admin/admin.css", "utf8");

    expect(markup).toContain("Coverage demand");
    expect(markup).toContain("Load demand");
    expect(markup).not.toContain("No demand");
    expect(source).toContain("/api/admin/area-demand?sinceDays=90&limit=50");
    expect(source).not.toMatch(/email|latitude|longitude|coordinates/iu);
    expect(css).toMatch(/\.admin-tabs\s*{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.admin-btn\s*{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.admin-tab\s*{[^}]*min-height:\s*44px/);
  });

  it("mounts the queue as its own admin tab", () => {
    const admin = readFileSync("app/admin/AdminClient.tsx", "utf8");

    expect(admin).toContain(
      'type AdminTab = "moderation" | "import" | "operators" | "coverage"',
    );
    expect(admin).toContain("<CoverageDemandQueue");
    expect(admin).toContain("Coverage demand");
  });
});
