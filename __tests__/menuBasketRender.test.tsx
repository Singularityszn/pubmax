// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import MenuBasket from "@/components/food/MenuBasket";
import type { FoodItem } from "@/lib/food";
import type { Drink } from "@/lib/drinks";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const food: FoodItem = { id: "meal", name: "Synthetic meal", category: "mains", priceGbp: 12, source: "https://example.com/menu", provenance: { source: "Synthetic test menu", licence: "test", observedAt: "2026-08-01" } };
const drink: Drink = { id: "soft", name: "Synthetic lemonade", category: "soft-drink", servingSize: "330ml bottle", priceGbp: 5, provenance: { source: "Synthetic test menu", sourceUrl: "https://example.com/menu", licence: "test", observedAt: "2026-08-01" } };
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
async function mount(f: FoodItem[], d: Drink[]) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<MenuBasket venueId="v" food={f} drinks={d} />));
  return host;
}
async function addItem(id: string) {
  const select = host!.querySelector("select")!;
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function quantity(name: string, value: string) {
  const input = host!.querySelector<HTMLInputElement>(`input[aria-label="Quantity of ${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("menu basket controls", () => {
  it("adds food and a soft drink without claiming a guaranteed payable total", async () => {
    const h = await mount([food], [drink]);
    await addItem("food:meal"); await addItem("drink:soft");
    expect(h.querySelector('[role="status"]')?.textContent).toContain("£17.00");
    expect(h.textContent).toContain("Full cost unknown");
    expect(h.textContent).toContain("330ml bottle");
    await quantity(food.name, "2");
    expect(h.querySelector('[role="status"]')?.textContent).toContain("£29.00");
    await act(async () => h.querySelector("button")!.click());
    expect(h.querySelector('[role="status"]')?.textContent).toContain("Choose an item");
  });
  it("shows missing prices and refused publisher links", async () => {
    const h = await mount([{ ...food, priceGbp: NaN, source: undefined }], []);
    await addItem("food:meal");
    expect(h.querySelector('[role="status"]')?.textContent).toContain("Incomplete");
    expect(h.querySelector("a")).toBeNull();
  });
});
