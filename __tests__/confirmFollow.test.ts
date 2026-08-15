import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, ...rest }, children),
}));

vi.mock("@/components/profile/HandleAvatar", () => ({
  default: () => createElement("span", null, "avatar"),
}));

// The two identity reads this surface makes. Both are TRI-STATE, which is the
// whole point of the states below: "not asked yet" is not "signed out".
const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  identityResolved: true,
}));
const viewer = vi.hoisted(() => ({ handle: null as string | null }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => auth,
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => viewer.handle,
}));

import ConfirmFollow from "@/components/social/ConfirmFollow";

function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(ConfirmFollow, { targetHandle: "karan", ...props }),
  );
}

beforeEach(() => {
  auth.user = null;
  auth.identityResolved = true;
  viewer.handle = null;
});

describe("ConfirmFollow", () => {
  it("asks a stranger for an account, and carries the add link through both doors", () => {
    const html = render();

    expect(html).toContain("Create account and add @karan");
    expect(html).toContain('href="/login?mode=signup&amp;from=%2Fadd%2Fkaran%3Fauto%3D1"');
    expect(html).toContain("I have an account, sign in");
    expect(html).toContain('href="/login?mode=signin&amp;from=%2Fadd%2Fkaran%3Fauto%3D1"');
    // The old device-handle path is gone: nobody adds a friend off localStorage.
    expect(html).not.toContain("Claim a handle to add them");
  });

  it("names the friend when the profile carries a display name", () => {
    const html = render({ targetName: "Karan M" });

    expect(html).toContain("Add Karan M?");
    expect(html).toContain("@karan");
    expect(html).toContain("Create account and add Karan M");
  });

  it("offers an account with no handle the claim surface, carrying the same return", () => {
    auth.user = { id: "user-1" };

    const html = render();

    expect(html).toContain("Choose a handle to add them");
    expect(html).toContain('href="/u/you?returnTo=%2Fadd%2Fkaran%3Fauto%3D1"');
  });

  it("offers a signed-in drinker the add itself", () => {
    auth.user = { id: "user-1" };
    viewer.handle = "newdrinker";

    const html = render();

    expect(html).toContain("Add @karan");
    expect(html).toContain("A lot is mutual.");
    expect(html).not.toContain("Create account and add");
  });

  it("names nobody and offers no door until the session answers", () => {
    auth.identityResolved = false;

    const html = render();

    expect(html).toContain("Checking your session.");
    expect(html).not.toContain("Create account and add");
    expect(html).not.toContain("I have an account, sign in");
  });

  it("turns your own link into the share surface", () => {
    auth.user = { id: "user-1" };
    viewer.handle = "karan";

    const html = render();

    expect(html).toContain("Share your link");
    expect(html).not.toContain("Create account and add");
  });

  it("does not treat a signed-out cached handle as the target account", () => {
    viewer.handle = "karan";

    const html = render({ targetName: "Karan M" });

    expect(html).toContain("Create account and add Karan M");
    expect(html).not.toContain("Share your link");
    expect(html).not.toContain("Add @karan</button>");
  });
});
