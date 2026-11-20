import { describe, expect, it } from "vitest";
import { selectPaydayPints } from "@/lib/paydayPint";

describe("payday pints", () => {
  it("selects attributed, dated prices near the chosen station", () => {
    const station = { name: "Example", lat: 51.5, lng: -0.1 };
    const rows = [
      { id: "near", name: "Nearby", lat: 51.5, lng: -0.1, priceSource: "Publisher", fairPint: [450, "https://example.com/price", "2026-11-01"] },
      { id: "far", name: "Far away", lat: 52, lng: -0.1, priceSource: "Publisher", fairPint: [100, "https://example.com/price", "2026-11-01"] },
      { id: "unknown", name: "Unknown", lat: 51.5, lng: -0.1, priceSource: "Publisher", fairPint: [200, "", "2026-11-01"] },
    ];
    expect(selectPaydayPints(station, rows, Date.parse("2026-11-20T09:00:00Z"))).toEqual([
      expect.objectContaining({ name: "Nearby", pricePence: 450, sourceUrl: "https://example.com/price", observedAt: "2026-11-01" }),
    ]);
  });

  it("excludes expired and future evidence before choosing the three cheapest prices", () => {
    const station = { name: "Bank", lat: 51.5, lng: -0.1 };
    const rows = [
      { id: "expired", name: "Old menu", lat: 51.5, lng: -0.1, fairPint: [400, "https://example.com/old", "2026-11-01"] },
      { id: "future", name: "Future menu", lat: 51.5, lng: -0.1, fairPint: [410, "https://example.com/future", "2027-11-06"] },
      { id: "edge", name: "One year old", lat: 51.5, lng: -0.1, fairPint: [450, "https://example.com/edge", "2026-11-05T09:00:00Z"] },
      { id: "fresh", name: "Fresh menu", lat: 51.5, lng: -0.1, fairPint: [500, "https://example.com/fresh", "2027-11-01"] },
      { id: "today", name: "Today's menu", lat: 51.5, lng: -0.1, fairPint: [550, "https://example.com/today", "2027-11-05T09:00:00Z"] },
    ];
    expect(selectPaydayPints(station, rows, Date.parse("2027-11-05T09:00:00Z")).map((pint) => pint.id)).toEqual(["edge", "fresh", "today"]);
  });
});

it("includes a working unsubscribe destination in both email formats", async () => {
  const { paydayPintEmail } = await import("@/lib/paydayPint");
  const message = paydayPintEmail({ name: "Bank", lat: 51.5, lng: -0.1 }, [], { to: "person@example.test", unsubscribeUrl: "https://pubmaxxing.com/api/payday-pint/unsubscribe?token=example", postalAddress: "Example sender" });
  expect(message.html).toContain("Unsubscribe</a>");
  expect(message.text).toContain("https://pubmaxxing.com/api/payday-pint/unsubscribe?token=example");
  expect(message.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
});
