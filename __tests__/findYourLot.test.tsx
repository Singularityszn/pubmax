import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ accountRevision: 0, user: null }),
}));

vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));

vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => true,
}));

import FindYourLot from "@/components/social/FindYourLot";

describe("FindYourLot for a stranger", () => {
  it("offers the handle search and no sign-in door of its own", () => {
    // The page a stranger is on already carries the one sign-in door (the
    // Social head), so this lane repeats none (taste plan, 18 Oct 2026).
    const html = renderToStaticMarkup(createElement(FindYourLot));

    expect(html).toContain('id="find-lot-title"');
    expect(html).toContain('type="search"');
    expect(html).not.toMatch(/Sign in/);
    expect(html).not.toContain('href="/login"');
  });
});

describe("FindYourLot with a query held by its page", () => {
  it("renders the held handle, so a remount in another place keeps it", () => {
    // /social mounts this lane in the door and then in the rail; the page holds
    // the typed handle so the swap between them does not clear the field.
    const html = renderToStaticMarkup(
      createElement(FindYourLot, { query: "alex", onQueryChange: () => {} }),
    );

    expect(html).toMatch(/type="search"[^>]*value="alex"/);
    expect(html).toContain(">Clear</button>");
  });
});
