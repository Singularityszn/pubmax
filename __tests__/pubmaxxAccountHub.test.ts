import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_NIGHT_PROFILE_INPUT } from "@/lib/nightProfile";
import { NightProfileControls, SocialConnectionActions } from "@/components/profile/PubmaxxAccountHub";

describe("PubmaxxAccountHub provider gating", () => {
  it("renders editable Night Profile controls with the privacy boundary", () => {
    const html = renderToStaticMarkup(createElement(NightProfileControls, {
      profile: DEFAULT_NIGHT_PROFILE_INPUT,
      saveLabel: "Saved on this device",
      onChange: vi.fn(),
    }));

    expect(html).toContain("Night Profile");
    expect(html).toContain("Your patch");
    expect(html).toContain("Max per person");
    expect(html).toContain("Voice");
    expect(html).toContain("Briefings");
    expect(html).toContain("Precise location and voice transcripts are never saved here.");
    expect(html).toContain("Saved on this device");
  });

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
