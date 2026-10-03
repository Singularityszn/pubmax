import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AnalyticsConsentPromptContent,
  consentFocusScrollDelta,
} from "@/components/AnalyticsConsentPrompt";

describe("first-visit analytics consent prompt", () => {
  it("asks plainly with equally direct accept and decline controls", () => {
    const markup = renderToStaticMarkup(createElement(AnalyticsConsentPromptContent, {
      onDecision: vi.fn(),
    }));
    const copy = markup.toLowerCase();

    // Product UI names the BRAND, never the app: the banner sits on every
    // first-visit page, so it was the loudest of the three surfaces reading
    // PUBMAXXING while the wordmark beside it read PUBMAXX.
    expect(markup).toContain("PUBMAXX analytics show us what people use");
    expect(markup).not.toContain("PUBMAXXING");
    expect(copy).toContain("what people use");
    expect(copy).toContain("never sold, no ads");
    expect(markup).toContain(">Allow<");
    expect(markup).toContain(">No thanks<");
    expect(markup).toContain('href="/privacy"');
  });
});

describe("consent focus clearance", () => {
  const lane = { top: 700, bottom: 780 };

  it("does not scroll a field that already finishes above the card", () => {
    expect(consentFocusScrollDelta(
      { top: 640, bottom: 700, height: 60, width: 200 },
      lane,
    )).toBe(0);
  });

  it("scrolls an overlapping field until its bottom meets the card's top", () => {
    expect(consentFocusScrollDelta(
      { top: 680, bottom: 740, height: 60, width: 200 },
      lane,
    )).toBe(40);
  });
});
