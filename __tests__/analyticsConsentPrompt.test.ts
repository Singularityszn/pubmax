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

    // Product UI names the BRAND, never the app: the banner sits on every
    // first-visit page, so it was the loudest of the three surfaces reading
    // PUBMAXXING while the wordmark beside it read PUBMAXX.
    expect(markup).toContain("PUBMAXX optional analytics");
    expect(markup).not.toContain("PUBMAXXING");
    expect(copy).toContain("what people use");
    expect(copy).toContain("never sold");
    expect(markup).toContain(">Allow<");
    expect(markup).toContain(">No thanks<");
    expect(markup).toContain('href="/privacy"');
  });
});
