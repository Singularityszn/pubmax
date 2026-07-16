import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SocialConnectionActions } from "@/components/profile/PubmaxxAccountHub";

describe("PubmaxxAccountHub provider gating", () => {
  it("renders only OAuth providers declared available by the server", () => {
    const html = renderToStaticMarkup(createElement(SocialConnectionActions, {
      providers: {
        x: { oauth: true, manual: false },
        instagram: { oauth: true, manual: true },
        tiktok: { oauth: false, manual: false },
      },
      onConnect: vi.fn(),
    }));

    expect(html).toContain("Connect X");
    expect(html).toContain("Connect Instagram");
    expect(html).not.toContain("Connect TikTok");
  });

  it("renders no dead OAuth controls when no provider is configured", () => {
    const html = renderToStaticMarkup(createElement(SocialConnectionActions, {
      providers: {
        x: { oauth: false, manual: false },
        instagram: { oauth: false, manual: true },
        tiktok: { oauth: false, manual: false },
      },
      onConnect: vi.fn(),
    }));
    expect(html).toBe("");
  });
});
