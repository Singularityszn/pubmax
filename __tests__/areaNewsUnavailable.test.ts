// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AreaNewsBlock from "@/components/areanews/AreaNewsBlock";
import AreaNewsRail from "@/components/desktop/AreaNewsRail";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("area-news unavailable state", () => {
  it("keeps an overdue desktop source distinct from a current empty check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "stale", entries: [] }), { status: 200 }),
      ),
    );

    await act(async () => {
      root.render(createElement(AreaNewsRail, { area: "soho" }));
    });

    expect(container.textContent).toContain("Area updates are out of date.");
    expect(container.textContent).not.toContain("No current updates here.");
  });

  it("keeps a failed client read out of the successful-empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "unavailable", entries: [] }), { status: 200 }),
      ),
    );

    await act(async () => {
      root.render(
        createElement(AreaNewsBlock, {
          area: "soho",
          areaLabel: "Soho",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Area updates are unavailable right now.");
    expect(container.textContent).not.toContain("No current updates here.");
  });
});
