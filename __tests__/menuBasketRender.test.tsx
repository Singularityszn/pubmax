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
  it.each([food, drink])("keeps $name and focus while its quantity is empty", async (item) => {
    const h = await mount([food], [drink]);
    h.querySelector("details")!.open = true;
    await addItem("food:meal"); await addItem("drink:soft");
    const input = h.querySelector<HTMLInputElement>(`input[aria-label="Quantity of ${item.name}"]`)!;
    input.focus();
    await quantity(item.name, "");
    expect(h.querySelectorAll("input")).toHaveLength(2);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(h.querySelector('[role="status"]')?.textContent).toContain("Menu subtotal: Incomplete");
    expect(h.querySelector('[role="status"]')?.textContent).not.toContain("£");
    await quantity(item.name, "2");
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("2");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(h.querySelector('[role="status"]')?.textContent).toContain(item === food ? "£29.00" : "£22.00");
    await quantity(item.name, "0");
    expect(input.isConnected).toBe(false);
    expect(h.querySelector('[role="status"]')?.textContent).toContain(item === food ? "£5.00" : "£12.00");
  });
  it.each([food, drink])("keeps $name pending for invalid quantities and permits recovery", async (item) => {
    const h = await mount([food], [drink]);
    await addItem("food:meal"); await addItem("drink:soft");
    for (const value of ["-1", "1.5", "101"]) {
      await quantity(item.name, value);
      expect(h.querySelectorAll("input")).toHaveLength(2);
      expect(h.querySelector('[role="status"]')?.textContent).toContain("Menu subtotal: Incomplete");
      expect(h.querySelector('[role="status"]')?.textContent).not.toContain("£");
    }
    await addItem(item === food ? "food:meal" : "drink:soft");
    expect(h.querySelector('[role="status"]')?.textContent).toContain("£17.00");
    await quantity(item.name, "");
    await act(async () => h.querySelector("button")!.click());
    expect(h.querySelectorAll("input")).toHaveLength(0);
    expect(h.querySelector('[role="status"]')?.textContent).toContain("Choose an item");
  });
  it("waits for every pending quantity before showing a subtotal", async () => {
    const h = await mount([food], [drink]);
    await addItem("food:meal");
    await quantity(food.name, "");
    await addItem("drink:soft");
    expect(h.querySelector('[role="status"]')?.textContent).toContain("Menu subtotal: Incomplete");
    await quantity(drink.name, "");
    await quantity(food.name, "2");
    expect(h.querySelector('[role="status"]')?.textContent).toContain("Menu subtotal: Incomplete");
    expect(h.querySelector('[role="status"]')?.textContent).not.toContain("£");
    await quantity(drink.name, "2");
    expect(h.querySelector('[role="status"]')?.textContent).toContain("£34.00");
  });
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
