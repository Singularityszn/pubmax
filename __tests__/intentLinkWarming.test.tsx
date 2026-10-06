// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const { prefetch } = vi.hoisted(() => ({ prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch }) }));
vi.mock("next/link", () => ({
  default: ({ prefetch: automaticPrefetch, ...props }: { href: string; prefetch?: boolean; children?: ReactNode }) => {
    expect(automaticPrefetch).toBe(false);
    return createElement("a", props);
  },
}));
import IntentLink from "@/components/nav/IntentLink";

it("warms sibling Social queries on hover and keeps repeated intent deduped", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement("div", null,
      createElement(IntentLink, { href: "/social?tab=discover#main" }, "Pubs & pints"),
      createElement(IntentLink, { href: "/social?feed=nearby" }, "Nearby"),
    )));
    const links = host.querySelectorAll("a");
    await act(async () => {
      links[0]?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      links[1]?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      links[0]?.focus();
    });
    expect(prefetch.mock.calls).toEqual([
      ["/social?tab=discover"], ["/social?feed=nearby"],
    ]);
    expect(links[0]?.getAttribute("href")).toBe("/social?tab=discover#main");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
