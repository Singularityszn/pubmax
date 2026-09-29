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
        status: { payload: null, failed: true, issueCount: 0 },
      }),
    );
    expect(html).toContain("TfL updates are unavailable.");
    expect(html).not.toContain("You look offline.");
  });

  it("uses honest offline copy for an unavailable live status", () => {
    vi.stubGlobal("window", { navigator: { onLine: false } });
    const html = renderToStaticMarkup(
      createElement(MobileTflPanel, {
        status: { payload: null, failed: true, issueCount: 0 },
      }),
    );
    expect(html).toContain("You look offline. We will retry when you are back.");
    expect(html).not.toContain("TfL updates are unavailable.");
  });
});
