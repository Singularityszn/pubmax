// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lazyPanel } from "@/components/map/lazyPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// A map panel whose chunk fails to load fails inside itself. The old bare
// React.lazy cached the rejected import and threw it to app/error.tsx, which
// replaced the whole map with "Spilled." (QA finding F03).

function Ready({ word }: { word: string }) {
  return createElement("p", { "data-testid": "ready" }, word);
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe("lazyPanel", () => {
  it("renders the panel once its chunk arrives", async () => {
    const Panel = lazyPanel<{ word: string }>(
      () => Promise.resolve({ default: Ready }),
      "Panel did not open.",
    );
    const el = mount(createElement(Panel, { word: "hello" }));
    await flush();
    expect(el.querySelector("[data-testid=ready]")?.textContent).toBe("hello");
    expect(el.querySelector(".lazyPanelFailed")).toBeNull();
  });

  it("keeps a failed chunk inside the panel instead of throwing to the app boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Panel = lazyPanel<{ word: string }>(
      () => Promise.reject(new Error("ChunkLoadError")),
      "Panel did not open.",
    );
    const el = mount(createElement(Panel, { word: "hello" }));
    await flush();
    const failed = el.querySelector(".lazyPanelFailed");
    expect(failed?.getAttribute("role")).toBe("alert");
    expect(failed?.textContent).toContain("Panel did not open.");
    expect(failed?.querySelector("button")?.textContent).toBe("Try again");
  });

  it("asks for the import again on Try again, so a recovered network opens the panel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi
      .fn<() => Promise<{ default: typeof Ready }>>()
      .mockRejectedValueOnce(new Error("ChunkLoadError"))
      .mockResolvedValue({ default: Ready });
    const Panel = lazyPanel<{ word: string }>(load, "Panel did not open.");
    const el = mount(createElement(Panel, { word: "back" }));
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(el.querySelector(".lazyPanelFailed")).not.toBeNull();

    act(() => {
      el.querySelector<HTMLButtonElement>(".lazyPanelFailed button")!.click();
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(el.querySelector(".lazyPanelFailed")).toBeNull();
    expect(el.querySelector("[data-testid=ready]")?.textContent).toBe("back");
  });

  it("stays on the failure panel while the import keeps failing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi.fn(() => Promise.reject(new Error("ChunkLoadError")));
    const Panel = lazyPanel<{ word: string }>(load, "Panel did not open.");
    const el = mount(createElement(Panel, { word: "x" }));
    await flush();
    for (let i = 0; i < 2; i += 1) {
      act(() => {
        el.querySelector<HTMLButtonElement>(".lazyPanelFailed button")!.click();
      });
      await flush();
      expect(el.querySelector(".lazyPanelFailed")).not.toBeNull();
    }
    expect(load).toHaveBeenCalledTimes(3);
  });
});
