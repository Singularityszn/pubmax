import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => Promise.resolve() }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
vi.mock("@/components/city/CityChooser", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/landing/ThamesHero", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/choose-city",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingPage from "@/components/landing/LandingPage";

// U2 — Landing Memory honesty while friends-launch is off.
// Soft launch keeps PUBMAX_SOCIAL_FRIENDS_LAUNCH unset/off. The Memory beat
// must not promise "Open Social" as if the product is open; primary path
// stays Plan, and the secondary CTA goes to private Memories on You.

const landingTsx = readFileSync(
  join(process.cwd(), "components/landing/LandingPage.tsx"),
  "utf8",
);
const pageTsx = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");

/** Visible copy only - comments explain the rule and must not trip it. */
function landingCopy(): string {
  return landingTsx
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
}

describe("landing Memory social honesty (U2)", () => {
  it("reads the friends-launch flag only on the landing RSC and threads it", () => {
    expect(pageTsx).toMatch(/readTrustedHandoffFlag/);
    expect(pageTsx).toMatch(/socialFriendsLaunch/);
    expect(pageTsx).toMatch(
      /socialFriendsLaunchEnabled=\{socialFriendsLaunchEnabled\}/,
    );
    // Client must not interpret the env itself (same fence as Find my pint).
    expect(landingTsx).not.toMatch(/process\.env/);
    expect(landingTsx).not.toMatch(/PUBMAX_SOCIAL_FRIENDS_LAUNCH/);
  });

  it("defaults the Memory secondary CTA away from Open Social when launch is off", () => {
    expect(landingTsx).toMatch(/socialFriendsLaunchEnabled\s*=\s*false/);
    const memoryBlock = landingTsx.match(
      /lpMemoryActions[\s\S]*?<\/div>\s*<\/div>\s*<ol className="lpMemorySteps"/,
    )?.[0];
    expect(memoryBlock, "Memory actions block present").toBeTruthy();
    expect(memoryBlock).toMatch(
      /href="\/plan"[\s\S]*lpButtonPrimary[\s\S]*Start a plan/,
    );
    expect(memoryBlock).toMatch(
      /socialFriendsLaunchEnabled\s*\?\s*\([\s\S]*Open Social[\s\S]*:\s*\([\s\S]*Open Memories/,
    );
    expect(memoryBlock).toMatch(/href="\/u\/you#night-memories"/);
    expect(memoryBlock).toMatch(/href="\/social"/);
  });

  it("keeps the open-product CTA wording to the launch-on branch alone", () => {
    const copy = landingCopy();
    const openSocialMatches = copy.match(/Open Social/g) ?? [];
    // Only the gated launch-on branch may say Open Social.
    expect(openSocialMatches).toHaveLength(1);
    expect(copy).toContain("Open Memories");
  });
});

// The landing document is one of the two the CDN holds, so its own nav is the
// first Social label most strangers read: it follows the same surface name the
// site nav, the palette and /social do, decided on the server.
describe("landing Social label follows the friends launch", () => {
  function socialLinkLabels(friendsLaunchEnabled: boolean): string[] {
    const markup = renderToStaticMarkup(
      createElement(LandingPage, {
        socialFriendsLaunchEnabled: friendsLaunchEnabled,
      }),
    );
    return [...markup.matchAll(/<a[^>]*href="\/social"[^>]*>([^<]*)</g)].map(
      (match) => match[1] as string,
    );
  }

  it("names the gated destination Social preview in nav and footer", () => {
    const labels = socialLinkLabels(false);
    expect(labels).toEqual(["Social preview", "Social preview"]);
  });

  it("names Social in nav and footer once the launch is on", () => {
    const labels = socialLinkLabels(true);
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(labels).toContain("Social");
    expect(labels).not.toContain("Social preview");
  });
});
