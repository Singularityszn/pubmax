// @vitest-environment jsdom
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined }),
}));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/map",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));
vi.mock("@/lib/mapWarmup", () => ({
  warmNavRoute: () => undefined,
}));
vi.mock("@/lib/mobileShell", () => ({
  requestMobileSheetDismiss: () => undefined,
}));
vi.mock("@/lib/softKeyboard", () => ({
  readSoftKeyboardOpen: () => false,
  serverSoftKeyboardOpen: () => false,
  subscribeSoftKeyboard: () => () => {},
}));
vi.mock("@/lib/useFocusTrap", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/useFocusTrap")>(),
  readStrictModalFocusTrap: () => false,
  serverStrictModalFocusTrap: () => false,
  subscribeStrictModalFocusTrap: () => () => {},
}));
vi.mock("@/components/command/CommandPaletteProvider", () => ({
  useCommandPalette: () => ({ open: () => {} }),
}));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));

import MobileTabBar from "@/components/nav/MobileTabBar";
import SiteNav from "@/components/nav/SiteNav";
import { SocialFriendsLaunchProvider } from "@/lib/useSocialFriendsLaunch";

// Social is a main tab by the captain's call (16 Oct 2026), and every bar names
// it for the launch state: "Social" while the friends launch is on, "Social
// preview" when it is rolled back, so no bar names it more plainly than the
// page it opens. The phone dock shows the word "Social" with the preview dot
// and carries the full name on the link, because "Social preview" does not fit
// a fifth of a 320px bar. The SERVER render is the one asserted: the flag is
// known when the root layout renders, so the HTML a stranger receives is the
// one that matters.
function serverRender(
  component: ComponentType,
  friendsLaunchEnabled: boolean,
): HTMLElement {
  // The provider's own props type names `children`, so createElement's props
  // overload would demand it there; the child belongs in the child argument.
  const LaunchProvider = SocialFriendsLaunchProvider as ComponentType<{
    value: boolean;
  }>;
  const markup = renderToStaticMarkup(
    createElement(
      LaunchProvider,
      { value: friendsLaunchEnabled },
      createElement(component),
    ),
  );
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
}

describe("the phone dock", () => {
  it.each([
    [true, "Social", false],
    [false, "Social preview", true],
  ])("carries one Social tab when the friends launch is %s, named %s", (enabled, name, dot) => {
    const host = serverRender(MobileTabBar, enabled);
    const tabs = host.querySelectorAll('a[href="/social"]');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.getAttribute("aria-label")).toBe(name);
    expect(tabs[0]?.querySelector(".mobileTabLabelText")?.textContent).toBe("Social");
    expect(Boolean(tabs[0]?.querySelector(".mobileTabPreviewDot"))).toBe(dot);
  });
});

describe("the desktop primary link row", () => {
  it.each([
    [true, "Social"],
    [false, "Social preview"],
  ])("carries one Social link when the friends launch is %s, named %s", (enabled, name) => {
    const host = serverRender(SiteNav, enabled);
    const links = host.querySelectorAll('.siteNavLinks a[href="/social"]');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe(name);
    expect(links[0]?.getAttribute("aria-label")).toBe(name);
  });
});
