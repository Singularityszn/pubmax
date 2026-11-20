// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import DealPriceComposer from "@/components/map/DealPriceComposer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, contributionAuth: null }) }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ signedOut: false }) }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));

it.each([false, true])("scrolls only when opened with visible layout, hasLayout=%s", async (hasLayout) => {
  const container = document.body.appendChild(document.createElement("div"));
  container.style.overflowY = "auto";
  container.scrollTop = 100;
  const scroll = vi.fn();
  container.scrollTo = scroll;
  const rect = { top: 220, bottom: 420, left: 0, right: 300, width: 300, height: 200, x: 0, y: 220, toJSON: () => ({}) };
  const rects = vi.spyOn(HTMLFormElement.prototype, "getClientRects").mockReturnValue({ length: hasLayout ? 1 : 0, item: () => hasLayout ? rect : null, [Symbol.iterator]: function* () { if (hasLayout) yield rect; } } as DOMRectList);
  const bounds = vi.spyOn(HTMLFormElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  container.getBoundingClientRect = () => ({ ...rect, top: 20 });
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const root = createRoot(container);
  try {
    for (const visible of [false, true, false, true]) {
      frame = undefined;
      scroll.mockClear();
      await act(async () => root.render(createElement(DealPriceComposer, { venueId: "venue-scroll", visible })));
      await act(async () => { frame?.(0); });
      expect(scroll.mock.calls).toEqual(visible && hasLayout ? [[{ top: 288, behavior: "instant" }]] : []);
    }
    frame = undefined;
    scroll.mockClear();
    await act(async () => root.render(createElement(DealPriceComposer, { venueId: "venue-scroll-next", visible: false })));
    await act(async () => { frame?.(0); });
    expect(scroll.mock.calls).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    rects.mockRestore();
    bounds.mockRestore();
    vi.unstubAllGlobals();
    container.remove();
  }
});

it("clears the draft and held contribution when the selected pub changes", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (venueId: string) => {
    await act(async () => root.render(createElement(DealPriceComposer, { venueId })));
  };
  const enter = async (label: string, value: string) => {
    const input = [...container.querySelectorAll("label")].find((element) => element.firstChild?.textContent === label)!.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  try {
    await render("venue-first");
    await enter("Drink", "Lager");
    await enter("Deal price (£)", "4.50");
    await enter("From", "16:00");
    await enter("Until", "19:00");
    await enter("Conditions (optional)", "With a meal");
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await render("venue-second");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect([...container.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])')].every((input) => input.value === "")).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]:checked')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
