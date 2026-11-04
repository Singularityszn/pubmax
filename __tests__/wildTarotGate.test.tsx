// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const { mountHeavyPreview } = vi.hoisted(() => ({ mountHeavyPreview: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => {
  mountHeavyPreview();
  return createElement("div", { "data-tarot": "" }, "Tarot");
} }));
import PubTarotGate from "@/components/wild/PubTarotGate";
import { writeWildMode } from "@/lib/wildMode";
import { writeWildNightPreview } from "@/lib/wildNightPreview";

afterEach(() => {
  writeWildMode(false); writeWildNightPreview(null); window.localStorage.clear();
  window.history.replaceState(null, "", "/"); vi.clearAllMocks();
});

it("keeps the normal roulette until both the wild switch and Pub Tarot selection are active", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); const root = createRoot(host);
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  act(() => root.render(<PubTarotGate cityId="london"><p>Normal roulette</p></PubTarotGate>));
  act(() => writeWildNightPreview("pub-tarot"));
  expect(host.textContent).toBe("Normal roulette"); expect(mountHeavyPreview).not.toHaveBeenCalled();
  act(() => writeWildMode(true));
  expect(host.querySelector("[data-tarot]")).not.toBeNull();
  act(() => writeWildNightPreview("borough-bingo"));
  expect(host.textContent).toBe("Normal roulette");
  act(() => writeWildNightPreview("pub-tarot"));
  act(() => writeWildMode(false));
  expect(host.textContent).toBe("Normal roulette");
  expect(fetcher).not.toHaveBeenCalled();
  act(() => root.unmount()); vi.unstubAllGlobals();
});
