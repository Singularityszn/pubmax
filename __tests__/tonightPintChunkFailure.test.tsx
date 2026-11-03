// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ requested: vi.fn() }));
vi.mock("@/components/wild/BeerMats", () => { boundary.requested(); throw new Error("chunk unavailable"); });
import TonightCheapPints from "@/app/tonight/TonightCheapPints";

describe("a failed presentation chunk", () => {
  it("keeps the neutral list usable", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const rows = [{ venueId: "venue-a", name: "The Pub", borough: "Camden", priceGbp: 5, chain: null,
      drinkLabel: "Selected lager", servingSize: "pint", publisher: { label: "Winner", url: "https://winner.example/menu" },
      observedAt: "2026-10-02T12:00:00.000Z" }] as const;
    await act(async () => { root.render(createElement(TonightCheapPints, { rows })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(boundary.requested).toHaveBeenCalledOnce();
    expect(host.querySelector('.tonightCheapPintsBeltList a[href*="venue-a"]')).not.toBeNull();
    expect(host.textContent).toContain("£5.00");
    expect(host.textContent).toContain("Selected lager");
    expect(host.textContent).toContain("Winner");
    expect(host.textContent).toContain("2 Oct 2026");
    expect(host.querySelector('a[href="https://winner.example/menu"]')).not.toBeNull();
    act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
  });
});
