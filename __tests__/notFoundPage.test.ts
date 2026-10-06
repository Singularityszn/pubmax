import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";

describe("branded 404", () => {
  const markup = renderToStaticMarkup(createElement(NotFound));

  it("carries the PUBMAXX wordmark", () => {
    expect(markup).toContain("PUBMAXX");
  });

  it("routes visitors back to the map and tonight", () => {
    expect(markup).toContain('href="/map"');
    expect(markup).toContain('href="/tonight"');
  });

  it("keeps the copy free of em dashes", () => {
    expect(markup).not.toContain("—");
  });

  it("follows the person's theme instead of committing to a dark surface", () => {
    // It used to paint #fdfaf2 and --ink-deep in both themes, so the consent
    // bar and tab bar sat light on top of it (QA journeys report F15).
    expect(markup).not.toMatch(/#fdfaf2|rgba\(253, 250, 242|ink-deep/i);
    expect(markup).toContain("background:var(--paper)");
    expect(markup).toContain("color:var(--ink)");
  });
});
