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
    writeWildNightPreview("borough-bingo");
    expect(readWildNightPreview()).toBe("borough-bingo");
    writeWildNightPreview("round-rota");
    expect(readWildNightPreview()).toBe("round-rota");
    writeWildNightPreview(null);
    expect(readWildNightPreview()).toBeNull();
  });

  it("adopts and removes only its parameter, preserving history, query and hash", () => {
    window.history.replaceState({ retained: true }, "", "/near?wild=1&q=a%20b&wildpreview=borough-bingo#top");
    const length = window.history.length;
    adoptWildNightPreviewFromAddress();
    expect(readWildNightPreview()).toBe("borough-bingo");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/near?wild=1&q=a%20b#top");
    expect(window.history.state).toEqual({ retained: true });
    expect(window.history.length).toBe(length);
    window.history.replaceState(null, "", "/near?wildpreview=off");
    adoptWildNightPreviewFromAddress();
    expect(readWildNightPreview()).toBeNull();
  });

  it("keeps an unavailable idea off when its old link is opened", () => {
    window.history.replaceState(null, "", "/near?wildpreview=pub-tarot&area=soho#top");
    adoptWildNightPreviewFromAddress();
    expect(readWildNightPreview()).toBeNull();
    expect(window.location.search + window.location.hash).toBe("?area=soho#top");
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
    function Probe() {
      const enabled = useWildNightPreview("borough-bingo");
      seen.push(enabled);
      return enabled ? createElement("div", { "data-preview-child": "" }, "Preview") : null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(false);
    expect(host.querySelector("[data-preview-child]")).toBeNull();
    act(() => writeWildNightPreview("borough-bingo"));
    expect(seen.at(-1)).toBe(false);
    act(() => writeWildMode(true));
    expect(seen.at(-1)).toBe(true);
    expect(host.querySelector("[data-preview-child]")).not.toBeNull();
    act(() => writeWildNightPreview("round-rota"));
    expect(seen.at(-1)).toBe(false);
    expect(host.querySelector("[data-preview-child]")).toBeNull();
    act(() => root.unmount());
  });
});

it("applies an off link while the preview hook stays mounted", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  writeWildMode(true);
  writeWildNightPreview("borough-bingo");
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe({ revision }: { revision: number }) {
    const enabled = useWildNightPreview("borough-bingo");
    return enabled ? createElement("div", { "data-preview-child": revision }, "Preview") : null;
  }
  act(() => root.render(createElement(Probe, { revision: 1 })));
  expect(host.querySelector("[data-preview-child]")).not.toBeNull();
  act(() => {
    window.history.pushState({ retained: true }, "", "/near?keep=1&wildpreview=off#here");
    window.dispatchEvent(new PopStateEvent("popstate"));
    root.render(createElement(Probe, { revision: 2 }));
  });
  expect(host.querySelector("[data-preview-child]")).toBeNull();
  expect(readWildNightPreview()).toBeNull();
  expect(window.location.search + window.location.hash).toBe("?keep=1#here");
  expect(window.history.state).toEqual({ retained: true });
  act(() => root.unmount());
});
