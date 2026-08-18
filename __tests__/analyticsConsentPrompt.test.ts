import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnalyticsConsentPromptContent } from "@/components/AnalyticsConsentPrompt";

describe("first-visit analytics consent prompt", () => {
  it("asks plainly with equally direct accept and decline controls", () => {
    const markup = renderToStaticMarkup(createElement(AnalyticsConsentPromptContent, {
      onDecision: vi.fn(),
    }));
    const copy = markup.toLowerCase();

    expect(markup).toContain("PUBMAXXING may use optional analytics");
    expect(copy).toContain("what people use");
    expect(copy).toContain("return for");
    expect(copy).toContain("never sold or used for ads");
    expect(markup).toContain(">Allow<");
    expect(markup).toContain(">No thanks<");
    expect(markup).toContain('href="/privacy"');
  });
});
