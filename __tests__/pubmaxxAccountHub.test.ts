import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_NIGHT_PROFILE_INPUT } from "@/lib/nightProfile";
import {
  NightProfileControls,
  ReferralInviteCard,
  SocialConnectionActions,
} from "@/components/profile/PubmaxxAccountHub";

describe("PubmaxxAccountHub provider gating", () => {
  it("loads optional referral status without blocking account data", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile/PubmaxxAccountHub.tsx"),
      "utf8",
    );
    expect(source).toContain("Promise.allSettled([");
    expect(source).not.toContain("void Promise.all([");
  });

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

  it("offers one quiet invite action and states the contribution gate truthfully", () => {
    const html = renderToStaticMarkup(createElement(ReferralInviteCard, {
      status: {
        attributedCount: 2,
        qualifiedCount: 1,
        earned: [],
        grantedFeatures: [],
        grantsEnabled: false,
        nextMilestone: 3,
      },
      busy: false,
      link: null,
      onInvite: vi.fn(),
    }));

    expect(html).toContain("Invite a mate");
    expect(html).toContain("first accepted contribution");
    expect(html).toContain("1 qualified referral");
    expect(html).toContain("Next milestone: 3");
    expect(html).toContain("Rewards stay off");
    expect(html).not.toMatch(/unlock/i);
    expect(html).not.toContain("inviter");
    expect(html).not.toContain("invitee");
  });

  it("shows a selectable link only after a deliberate invite action", () => {
    const withoutLink = renderToStaticMarkup(createElement(ReferralInviteCard, {
      status: null,
      busy: false,
      link: null,
      onInvite: vi.fn(),
    }));
    const withLink = renderToStaticMarkup(createElement(ReferralInviteCard, {
      status: null,
      busy: false,
      link: "https://pubmaxxing.com/r/opaque",
      onInvite: vi.fn(),
    }));

    expect(withoutLink).not.toContain("https://pubmaxxing.com/r/opaque");
    expect(withLink).toContain("https://pubmaxxing.com/r/opaque");
    expect(withLink).toContain('readOnly=""');
  });
});
