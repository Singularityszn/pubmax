// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialSurfaceName: () => "Social" }));

import CommandPalette from "@/components/command/CommandPalette";

const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  window.history.replaceState(null, "", "/");
});

it.each(["/map", "/places"])("opens price entry from %s through the appropriate navigation", async (path) => {
  window.history.replaceState(null, "", path);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const close = vi.fn();
  try {
    await act(async () => root.render(<CommandPalette onClose={close} />));
    const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((element) => element.textContent?.includes("Drop a pint price"));
    expect(option).toBeDefined();
    await act(async () => option!.click());
    expect(close).toHaveBeenCalledOnce();
    if (path === "/map") {
      // A native query update keeps the mounted map, its camera and GPS fix.
      expect(window.location.pathname + window.location.search).toBe("/map?log=1");
      expect(push).not.toHaveBeenCalled();
    } else {
      expect(push).toHaveBeenCalledExactlyOnceWith("/map?log=1");
      expect(window.location.pathname).toBe("/places");
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
