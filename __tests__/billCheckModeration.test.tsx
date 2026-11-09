// @vitest-environment jsdom

import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import BillCheckModeration from "@/app/admin/BillCheckModeration";
import type { ModeratorBillCheck } from "@/lib/billCheck";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => createElement("img", props),
}));

describe("bill check moderation", () => {
  it.each(["community", "pint-drop", "round"] as const)(
    "shows the submitted drink, price and bill lines for a %s check",
    async (source) => {
      const communityOnly = source === "community";
      const check: ModeratorBillCheck = {
        id: "check-coffee", venueId: "venue-1", venueName: "The Ship",
        priceGbp: 4, result: "mismatch", lines: [{ name: "Coffee", priceGbp: 3 }],
        checkedAt: "2026-11-05T19:30:00.000Z", submittedDrink: "Coffee",
        communityOnly, receiptPhotoUrl: communityOnly ? null : "https://storage.test/bill.jpg",
        ...(source === "pint-drop" ? {
          pintDropId: "drop-1",
          drop: { id: "drop-1", handle: "drinker", drink: "Coffee", status: "visible", createdAt: "2026-11-05T19:30:00.000Z" },
        } : { communityPriceId: "price-1" }),
      };
      const request = vi.fn(async () => new Response(JSON.stringify({ checks: [check] })));
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      try {
        await act(async () => root.render(createElement(BillCheckModeration, { request })));
        const load = [...host.querySelectorAll("button")].find((button) => button.textContent === "Load bills");
        if (!load) throw new Error("Load bills button was not rendered");
        await act(async () => load.click());
        expect(request).toHaveBeenCalledWith("/api/admin/bill-checks");
        const card = host.querySelector('[data-testid="admin-bill-check"]');
        expect(card?.querySelector(".admin-bill-sent")?.closest("p")?.textContent).toContain("Coffee");
        expect(card?.querySelector(".admin-bill-sent")?.textContent).toBe("£4.00");
        expect(card?.querySelector("li")?.textContent).toBe("Coffee£3.00");
        expect(card?.textContent?.includes("Photo not kept for community submissions")).toBe(communityOnly);
        expect(card?.querySelector("img")?.getAttribute("src") ?? null).toBe(check.receiptPhotoUrl);
        expect(card?.querySelector(".admin-bill-photo")?.getAttribute("href") ?? null).toBe(check.receiptPhotoUrl);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
});
