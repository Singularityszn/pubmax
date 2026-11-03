// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import BeerMats from "@/components/wild/BeerMats";

describe("selected pint evidence", () => {
  it("shows the hunt's selected drink, serving, publisher, URL and day on the back", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const rows = [{ venueId: "venue-a", name: "The Pub", borough: "Camden", priceGbp: 5, chain: null,
      drinkLabel: "Selected lager", servingSize: "pint", publisher: { label: "Winner", url: "https://winner.example/menu" },
      observedAt: "2026-10-02T12:00:00.000Z" }] as const;
    await act(async () => { root.render(createElement(BeerMats, { rows })); });
    const button = host.querySelector<HTMLButtonElement>("button.beerMatToggle")!;
    act(() => button.click());
    const back = host.querySelector<HTMLElement>(".beerMatBack")!;
    expect(back.hasAttribute("inert")).toBe(false);
    expect(back.textContent).toContain("Selected lager");
    expect(back.textContent?.toLowerCase()).toContain("pint");
    expect(back.textContent).toContain("Winner");
    expect(back.querySelector('a[href="https://winner.example/menu"]')).not.toBeNull();
    expect(back.textContent).toContain("2 Oct 2026");
    expect(fetchSpy).not.toHaveBeenCalled();
    act(() => root.unmount()); host.remove(); fetchSpy.mockRestore();
  });
});
