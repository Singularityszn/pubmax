// @vitest-environment jsdom

import {
  act,
  createElement,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...props }: {
    href: string;
    children: ReactNode;
    onClick?: () => void;
  }) => createElement("a", {
    href,
    ...props,
    onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      onClick?.();
    },
  }, children),
}));

import PalGuestAccountGate from "@/components/pal/PalGuestAccountGate";

let root: Root | null;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe("PalGuestAccountGate", () => {
  it("focuses the gate and offers 44px account actions after five answers", async () => {
    const onSignInOpen = vi.fn();
    await act(async () => {
      root?.render(createElement(PalGuestAccountGate, {
        onSignInOpen,
        palName: "Morrow",
      }));
      await Promise.resolve();
    });

    const heading = container.querySelector<HTMLHeadingElement>("h2");
    expect(heading?.textContent).toBe("Five guest answers complete");
    expect(document.activeElement).toBe(heading);
    expect(container.textContent).toContain("keep talking with Morrow");

    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Create account", "/login?mode=signup&from=%2Fpal"],
      ["Sign in", "/login?mode=signin&from=%2Fpal"],
    ]);
    for (const link of links) {
      expect(link.style.minHeight).toBe("44px");
      link.click();
    }
    expect(onSignInOpen).toHaveBeenCalledTimes(2);
  });
});
