// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/wild/BeerMats", () => ({ default: () => createElement("div", { "data-testid": "mats" }, "Mats") }));
vi.mock("@/app/tonight/TonightPintBelt", () => ({ default: () => createElement("div", { "data-testid": "belt" }, "Belt") }));

import TonightCheapPints from "@/app/tonight/TonightCheapPints";

const rows = [{ venueId: "venue-a", name: "The Pub", borough: "Camden", priceGbp: 5, chain: null }] as const;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); vi.unstubAllGlobals(); });

describe("Tonight's responsive pint presentation", () => {
  for (const [width, expected] of [[599, "mats"], [600, "belt"], [641, "belt"]] as const) {
    it(`selects ${expected} at ${width}px`, async () => {
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width: 600px") && width >= 600, addEventListener() {}, removeEventListener() {} }));
      host = document.createElement("div"); document.body.append(host); root = createRoot(host);
      await act(async () => { root.render(createElement(TonightCheapPints, { rows })); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(host.querySelector(`[data-testid="${expected}"]`)).not.toBeNull();
      expect(host.querySelector(`[data-testid="${expected === "mats" ? "belt" : "mats"}"]`)).toBeNull();
    });
  }
  it("keeps a busy night empty even when wild mode is on", async () => {
    window.localStorage.setItem("pubmax-wild", "1");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root.render(createElement(TonightCheapPints, { rows, show: false })); });
    expect(host.innerHTML).toBe("");
    window.localStorage.removeItem("pubmax-wild");
  });
});
