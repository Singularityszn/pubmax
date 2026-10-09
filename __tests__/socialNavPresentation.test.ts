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

// Social is not a front door. It answers "Sign in to use Social." to a stranger,
// so it has left the primary chrome whatever the launch flag says, and lives in
// the desktop More menu (see siteNav.test.ts for its honest label there). The
// SERVER render is the one asserted: the flag is known when the root layout
// renders, so the HTML a stranger receives is the one that matters.
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
  it.each([true, false])("carries no Social tab when the friends launch is %s", (enabled) => {
    const host = serverRender(MobileTabBar, enabled);
    expect(host.querySelector('a[href^="/social"]')).toBeNull();
    expect(host.textContent).not.toContain("Social");
  });
});

describe("the desktop primary link row", () => {
  it.each([true, false])("carries no Social link when the friends launch is %s", (enabled) => {
    const host = serverRender(SiteNav, enabled);
    expect(host.querySelector('.siteNavLinks a[href^="/social"]')).toBeNull();
    expect(host.querySelector(".siteNavLinks")?.textContent).not.toContain("Social");
  });
});
