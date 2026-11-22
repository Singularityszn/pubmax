// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lazyPanel, SEARCH_CHUNK_RELOAD_KEY } from "@/components/map/lazyPanel";

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
  vi.unstubAllGlobals();
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

  it("opens a reopened panel at once, without asking for its chunk again", async () => {
    const load = vi.fn(() => Promise.resolve({ default: Ready }));
    const Panel = lazyPanel<{ word: string }>(load, "Panel did not open.");
    mount(createElement(Panel, { word: "first" }));
    await flush();
    act(() => root?.unmount());
    host?.remove();

    // No flush: a loaded panel must render in the opening commit, so a field
    // that autofocuses inside it still runs within the tap that opened it.
    const el = mount(createElement(Panel, { word: "again" }));
    expect(el.querySelector("[data-testid=ready]")?.textContent).toBe("again");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("opens a warmed panel in its first commit, without asking for its chunk again", async () => {
    const load = vi.fn(() => Promise.resolve({ default: Ready }));
    const Panel = lazyPanel<{ word: string }>(load, "Panel did not open.");
    await Panel.warm();

    // No flush: the warm already holds the module, so the tap that opens the
    // panel draws it in the same commit instead of one empty frame later.
    const el = mount(createElement(Panel, { word: "warm" }));
    expect(el.querySelector("[data-testid=ready]")?.textContent).toBe("warm");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("asks for the import again on open when the warm failed", async () => {
    const load = vi
      .fn<() => Promise<{ default: typeof Ready }>>()
      .mockRejectedValueOnce(new Error("ChunkLoadError"))
      .mockResolvedValue({ default: Ready });
    const Panel = lazyPanel<{ word: string }>(load, "Panel did not open.");
    await Panel.warm();

    const el = mount(createElement(Panel, { word: "late" }));
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(el.querySelector(".lazyPanelFailed")).toBeNull();
    expect(el.querySelector("[data-testid=ready]")?.textContent).toBe("late");
  });

  it("asks for the import again when a panel that failed is opened again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi
      .fn<() => Promise<{ default: typeof Ready }>>()
      .mockRejectedValueOnce(new Error("ChunkLoadError"))
      .mockResolvedValue({ default: Ready });
    const Panel = lazyPanel<{ word: string }>(load, "Panel did not open.");
    mount(createElement(Panel, { word: "first" }));
    await flush();
    act(() => root?.unmount());
    host?.remove();

    const el = mount(createElement(Panel, { word: "reopened" }));
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(el.querySelector(".lazyPanelFailed")).toBeNull();
    expect(el.querySelector("[data-testid=ready]")?.textContent).toBe("reopened");
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

  it.each(["available", "blocked"] as const)(
    "allows explicit recovery after a failed reload with %s storage",
    async (storage) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const href = "https://pubmaxxing.com/map?city=london#search";
      const reload = vi.fn();
      vi.stubGlobal("location", { href, reload });
      if (storage === "blocked") {
        const refuse = () => { throw new DOMException("Storage blocked", "SecurityError"); };
        vi.stubGlobal("sessionStorage", { getItem: refuse, setItem: refuse, removeItem: refuse });
      } else {
        sessionStorage.removeItem(SEARCH_CHUNK_RELOAD_KEY);
      }
      let online = false;
      const error = Object.assign(new Error("Search chunk unavailable"), { name: "ChunkLoadError" });
      const load = () => online ? Promise.resolve({ default: Ready }) : Promise.reject(error);
      const Panel = lazyPanel<{ word: string }>(load, "Panel did not open.");
      const el = mount(createElement(Panel, { word: "first" }));
      await act(async () => {});
      expect(el.querySelector(".lazyPanelFailed")).not.toBeNull();
      expect(reload).not.toHaveBeenCalled();

      await act(async () => {
        el.querySelector<HTMLButtonElement>(".lazyPanelFailed button")!.click();
      });
      expect(reload).toHaveBeenCalledTimes(1);
      if (storage === "available") {
        expect(sessionStorage.getItem(SEARCH_CHUNK_RELOAD_KEY)).toBe(href);
      }

      act(() => root!.unmount());
      host!.remove();
      const ReloadedPanel = lazyPanel<{ word: string }>(load, "Panel did not open.");
      const reloaded = mount(createElement(ReloadedPanel, { word: "recovered" }));
      await act(async () => {});
      expect(reloaded.querySelector(".lazyPanelFailed")).not.toBeNull();
      expect(reload).toHaveBeenCalledTimes(1);

      await act(async () => {
        reloaded.querySelector<HTMLButtonElement>(".lazyPanelFailed button")!.click();
      });
      expect(reload).toHaveBeenCalledTimes(2);
      expect(location.href).toBe(href);

      online = true;
      await act(async () => {
        reloaded.querySelector<HTMLButtonElement>(".lazyPanelFailed button")!.click();
      });
      expect(reloaded.querySelector("[data-testid=ready]")?.textContent).toBe("recovered");
      expect(reloaded.querySelector(".lazyPanelFailed")).toBeNull();
      expect(reload).toHaveBeenCalledTimes(2);
      if (storage === "available") {
        expect(sessionStorage.getItem(SEARCH_CHUNK_RELOAD_KEY)).toBeNull();
      }
    },
  );
});
