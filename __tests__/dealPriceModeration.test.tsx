// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import DealPriceModeration from "@/app/admin/DealPriceModeration";
import type { DealPrice } from "@/lib/dealPrice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Fetch's Body contract requires reads and moderation acknowledgements to be
// consumed or cancelled, including conflicts that refresh the queue.
it("releases a failed moderation read and shows the read error", async () => {
  const response = new Response("Unavailable", { status: 503 });
  vi.stubGlobal("fetch", vi.fn(async () => response));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(DealPriceModeration, { sessionReady: true })));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Could not load deal reports.");
    expect(response.bodyUsed).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it.each(["Hide", "Keep", "Restore"])("releases every %s response and preserves the queue result", async (action) => {
  const deal: DealPrice & { hidden: boolean; revision: string } = {
    id: "reported", venueId: "venue-reported", drinkCategory: "beer", drink: "Lager", measure: "pint", measureLabel: "", priceGbp: 4.5,
    schedule: { days: [5], start: "16:00", end: "19:00" }, reportedAt: "2026-11-20T12:00:00Z", endDate: null, conditions: "",
    hidden: action === "Restore", revision: "revision",
  };
  const responses: Response[] = [];
  let status = 503;
  let loaded = 0;
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const response = init?.method === "POST"
      ? new Response(JSON.stringify({ ok: status === 200 }), { status })
      : new Response(JSON.stringify({ deals: [deal] }));
    if (init?.method !== "POST") loaded += 1;
    responses.push(response);
    return response;
  }));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(DealPriceModeration, { sessionReady: true })));
    expect(loaded).toBe(1);
    for (const nextStatus of [503, 409, 200]) {
      status = nextStatus;
      const button = [...container.querySelectorAll("button")].find((item) => item.textContent === action)!;
      expect(button.disabled).toBe(false);
      await act(async () => button.click());
      if (status === 503) {
        expect(container.querySelector('[role="status"]')?.textContent).toContain("Could not update the deal.");
        expect(loaded).toBe(1);
      } else if (status === 409) {
        expect(container.querySelector('[role="status"]')?.textContent).toContain("The deal changed.");
        expect(loaded).toBe(2);
      } else {
        expect(container.querySelector('[role="status"]')).toBeNull();
        expect(loaded).toBe(3);
      }
    }
    expect(responses.every((response) => response.bodyUsed)).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
