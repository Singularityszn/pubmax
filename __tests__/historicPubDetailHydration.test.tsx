/** @vitest-environment jsdom */

import { createElement } from "react";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HistoricPub } from "@/lib/historic";
import { loadHistoricPubs } from "@/lib/historic";

vi.mock("next/navigation", () => ({
  usePathname: () => "/historic/prospect-of-whitby",
  useRouter: () => ({
    prefetch: () => Promise.resolve(),
    push: () => undefined,
    replace: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/command/CommandPaletteProvider", () => ({
  useCommandPalette: () => ({ open: () => undefined }),
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialSurfaceName: () => "Out",
}));
vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  analyticsCollectionAllowed: () => false,
}));

import HistoricPubDetail from "@/app/historic/[slug]/HistoricPubDetail";
import SiteNav from "@/components/nav/SiteNav";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

function Page({ pub }: { pub: HistoricPub }) {
  return createElement(
    "main",
    { id: "main", className: "hdPage" },
    createElement(SiteNav, { active: "historic" }),
    createElement(HistoricPubDetail, { pub }),
  );
}

describe("historic pub detail hydration", () => {
  it("hydrates prospect-of-whitby without mismatch warnings", async () => {
    const pubs = await loadHistoricPubs();
    const pub = pubs.find((row) => row.slug === "prospect-of-whitby");
    expect(pub).toBeTruthy();

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn(),
    });

    const serverHtml = renderToString(createElement(Page, { pub: pub! }));
    host = document.createElement("div");
    host.innerHTML = serverHtml;
    document.body.append(host);

    const complaints: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      complaints.push(args.map((arg) => String(arg)).join(" "));
    });

    await act(async () => {
      root = hydrateRoot(host!, createElement(Page, { pub: pub! }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      complaints.filter((line) => /hydrat|did not match|mismatch|418/i.test(line)),
    ).toEqual([]);
  });
});
