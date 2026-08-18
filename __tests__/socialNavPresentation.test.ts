import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined }),
}));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/map",
  subscribePreferredCity: () => () => {},
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));
vi.mock("@/lib/backgroundWarmup", () => ({
  whenBackgroundWarmupAllowed: (run: () => void) => run(),
}));
vi.mock("@/lib/mapWarmup", () => ({
  warmNavRoute: () => undefined,
  warmPrimaryTabRoutes: () => undefined,
}));
vi.mock("@/lib/mobileShell", () => ({
  requestMobileSheetDismiss: () => undefined,
}));
vi.mock("@/lib/softKeyboard", () => ({
  readSoftKeyboardOpen: () => false,
  serverSoftKeyboardOpen: () => false,
  subscribeSoftKeyboard: () => () => {},
}));
vi.mock("@/lib/useFocusTrap", () => ({
  readStrictModalFocusTrap: () => false,
  serverStrictModalFocusTrap: () => false,
  subscribeStrictModalFocusTrap: () => () => {},
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => false,
  useSocialNavShowsPreviewBadge: () => true,
}));

import MobileTabBar from "@/components/nav/MobileTabBar";

describe("social nav presentation", () => {
  it("keeps the mobile tab label Social and wears a preview badge when gated", () => {
    const markup = renderToStaticMarkup(createElement(MobileTabBar));
    expect(markup).toContain('class="mobileTabLabel"');
    expect(markup).toContain(">Social<");
    expect(markup).toContain('class="mobileTabPreviewBadge"');
    expect(markup).toContain(">Preview<");
    expect(markup).not.toContain("Social preview");
  });
});
