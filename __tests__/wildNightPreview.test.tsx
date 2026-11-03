// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWildNightPreview } from "@/lib/useWildNightPreview";
import { writeWildMode } from "@/lib/wildMode";
import {
  WILD_NIGHT_PREVIEW_KEY,
  adoptWildNightPreviewFromAddress,
  readWildNightPreview,
  subscribeWildNightPreview,
  writeWildNightPreview,
} from "@/lib/wildNightPreview";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("wild night preview", () => {
  it("starts off and permits one preview at a time", () => {
    expect(readWildNightPreview()).toBeNull();
    writeWildNightPreview("pub-tarot");
    expect(readWildNightPreview()).toBe("pub-tarot");
    writeWildNightPreview("round-rota");
    expect(readWildNightPreview()).toBe("round-rota");
    writeWildNightPreview(null);
    expect(readWildNightPreview()).toBeNull();
  });

  it("adopts and removes only its parameter, preserving history, query and hash", () => {
    window.history.replaceState({ retained: true }, "", "/near?wild=1&q=a%20b&wildpreview=pub-tarot#top");
    const length = window.history.length;
    adoptWildNightPreviewFromAddress();
    expect(readWildNightPreview()).toBe("pub-tarot");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/near?wild=1&q=a%20b#top");
    expect(window.history.state).toEqual({ retained: true });
    expect(window.history.length).toBe(length);
    window.history.replaceState(null, "", "/near?wildpreview=off");
    adoptWildNightPreviewFromAddress();
    expect(readWildNightPreview()).toBeNull();
  });

  it("rejects unknown selections and notifies other tabs", () => {
    window.localStorage.setItem(WILD_NIGHT_PREVIEW_KEY, "bogus");
    expect(readWildNightPreview()).toBeNull();
    const listener = vi.fn();
    const stop = subscribeWildNightPreview(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: WILD_NIGHT_PREVIEW_KEY, newValue: "borough-bingo" }));
    expect(listener).toHaveBeenCalledOnce();
    stop();
  });

  it("requires both the master switch and the selected preview", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const seen: boolean[] = [];
    function Probe() { seen.push(useWildNightPreview("pub-tarot")); return null; }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(false);
    act(() => writeWildNightPreview("pub-tarot"));
    expect(seen.at(-1)).toBe(false);
    act(() => writeWildMode(true));
    expect(seen.at(-1)).toBe(true);
    act(() => writeWildNightPreview("round-rota"));
    expect(seen.at(-1)).toBe(false);
    act(() => root.unmount());
  });
});
