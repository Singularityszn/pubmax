import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import EmptyState from "@/components/EmptyState";

// EmptyState is the shared "honest, beautiful empty state" contract (GH #18):
// short serif title, muted explainer, at most one action, role="status" by
// default. Rendered via react-dom/server (no jsdom needed) so this stays a
// plain node-environment unit test, matching the rest of this suite.
describe("EmptyState", () => {
  it("renders the title and defaults to role=status (a passive result, not an error)", () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { title: "Nothing here yet." }));
    expect(html).toContain("Nothing here yet.");
    expect(html).toContain('role="status"');
    // No eyebrow/body/action passed → none of those wrapper elements render.
    expect(html).not.toContain("emptyStateEyebrow");
    expect(html).not.toContain("emptyStateBody");
    expect(html).not.toContain("emptyStateAction");
  });

  it("renders the eyebrow, body, and action when provided", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        eyebrow: "Quiet at the bar",
        title: "No pints logged yet tonight.",
        body: "Be the first to drop one.",
        action: createElement("a", { href: "/map" }, "Find a pub"),
      }),
    );
    expect(html).toContain("Quiet at the bar");
    expect(html).toContain("No pints logged yet tonight.");
    expect(html).toContain("Be the first to drop one.");
    expect(html).toContain("Find a pub");
    expect(html).toContain('href="/map"');
  });

  it("supports role=alert for a failed (not merely empty) result", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: "Couldn't load pints.", role: "alert" }),
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it("appends a page-specific className to the root without dropping the base class", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: "No saved pubs yet.", className: "feedEmpty" }),
    );
    expect(html).toContain('class="emptyState feedEmpty"');
  });
});
