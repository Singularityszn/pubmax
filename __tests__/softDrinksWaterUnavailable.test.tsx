// @vitest-environment jsdom
// A BUNDLE WE COULD NOT READ IS NOT A BUNDLE WITH NO PRICES. When
// public/data/uk_prices/rows.json fails to load, the Lucia 🐐 view must say it
// could not look, never "No listed … prices" or "Nobody has logged one".

import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));
vi.mock("@/components/drinks/SoftDrinkSubtypeMiniMap", () => ({ default: () => null }));
vi.mock("@/components/drinks/drinkSubtypePricedView.css", () => ({}));

import DrinkSubtypePricedView from "@/components/drinks/DrinkSubtypePricedView";

const LAUNCH = ["soft-drink-lucia-special", "soft-drink-zero-sugar-cola", "soft-drink-still-water"];

function render(listedPricesUnavailable: boolean) {
  return renderToStaticMarkup(
    <DrinkSubtypePricedView
      title="Soft drinks and water"
      launchSubtypeIds={LAUNCH}
      activeSubtypeId="soft-drink-lucia-special"
      rows={[]}
      observedCounts={{ "soft-drink-lucia-special": 0 }}
      listedPricesUnavailable={listedPricesUnavailable}
    />,
  );
}

describe("DrinkSubtypePricedView when the listed prices could not be read", () => {
  it("says it could not read them", () => {
    const html = render(true);
    expect(html).toContain("Could not read the listed Coke Zero and Diet Coke prices just now.");
    expect(html).toContain("Prices could not load.");
    expect(html).not.toContain("No listed");
    expect(html).not.toContain("Nobody has logged one here yet.");
  });

  it("still says none when the read worked and found none", () => {
    const html = render(false);
    expect(html).toContain("No listed Coke Zero and Diet Coke prices in London yet.");
    expect(html).toContain("Nobody has logged one here yet.");
  });
});

it("starts at the first pub when a reader switches drinks and returns", async () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    venueId: `pub-${index + 1}`,
    venueName: `Pub ${String(index + 1).padStart(2, "0")}`,
    borough: "Westminster",
    latitude: 51.51,
    longitude: -0.13,
    observed: null,
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const show = async (subtype: string) => act(async () => root.render(
    <DrinkSubtypePricedView title="Soft drinks and water" launchSubtypeIds={LAUNCH}
      activeSubtypeId={subtype} rows={rows} observedCounts={{ [subtype]: 1 }} />,
  ));
  try {
    await show("soft-drink-lucia-special");
    const list = container.querySelector("ol")!;
    Object.defineProperty(list, "scrollIntoView", { value: () => {} });
    const next = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Next")!;
    await act(async () => next.click());
    expect(list.start).toBe(25);
    expect(list.querySelector("a")?.textContent).toBe("Pub 25");
    await show("soft-drink-still-water");
    expect(list.start).toBe(1);
    await show("soft-drink-lucia-special");
    expect(list.start).toBe(1);
    expect(list.querySelector("a")?.textContent).toBe("Pub 01");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
