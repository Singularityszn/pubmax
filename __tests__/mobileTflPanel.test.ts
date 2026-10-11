import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import MobileTflPanel from "@/components/mobile/MobileTflPanel";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MobileTflPanel resilience", () => {
  it("keeps online fault copy for an unavailable live status", () => {
    const html = renderToStaticMarkup(
      createElement(MobileTflPanel, {
        status: { payload: null, failed: true, issueCount: 0, urgentCount: 0 },
      }),
    );
    expect(html).toContain("TfL updates are unavailable.");
    expect(html).not.toContain("You look offline.");
  });

  it("uses honest offline copy for an unavailable live status", () => {
    vi.stubGlobal("window", { navigator: { onLine: false } });
    const html = renderToStaticMarkup(
      createElement(MobileTflPanel, {
        status: { payload: null, failed: true, issueCount: 0, urgentCount: 0 },
      }),
    );
    expect(html).toContain("You look offline. We will retry when you are back.");
    expect(html).not.toContain("TfL updates are unavailable.");
  });
});

describe("MobileTflPanel signal sources", () => {
  const payload = {
    asOf: "2026-10-06T19:29:05.385Z",
    signals: [
      {
        kind: "event",
        headline: "The Strokes Concert at The O2 Arena",
        detail: "A concert at the O2.",
        timeWindow: "18:30-22:45",
        areas: ["North Greenwich"],
        sourceUrl: "https://www.timeout.com/london/news/the-strokes-o2",
      },
      { kind: "event", headline: "A row with no source" },
      { kind: "event", headline: "A row with a script source", sourceUrl: "javascript:alert(1)" },
    ],
  };

  it("links each sourced signal to its publisher, and says so when there is none (F14)", () => {
    const html = renderToStaticMarkup(
      createElement(MobileTflPanel, { status: { payload, failed: false, issueCount: 3, urgentCount: 0 } }),
    );
    expect(html).toContain('href="https://www.timeout.com/london/news/the-strokes-o2"');
    expect(html).toContain("Source: timeout.com ↗");
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).not.toContain("javascript:");
    expect(html.match(/>CityMCP</g)).toHaveLength(2);
  });
});
