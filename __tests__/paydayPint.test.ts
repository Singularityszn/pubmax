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
    expect(selectPaydayPints(station, rows)).toEqual([
      expect.objectContaining({ name: "Nearby", pricePence: 450, sourceUrl: "https://example.com/price", observedAt: "2026-11-01" }),
    ]);
  });
});

it("includes a working unsubscribe destination in both email formats", async () => {
  const { paydayPintEmail } = await import("@/lib/paydayPint");
  const message = paydayPintEmail({ name: "Bank", lat: 51.5, lng: -0.1 }, [], { to: "person@example.test", unsubscribeUrl: "https://pubmaxxing.com/api/payday-pint/unsubscribe?token=example", postalAddress: "Example sender" });
  expect(message.html).toContain("Unsubscribe</a>");
  expect(message.text).toContain("https://pubmaxxing.com/api/payday-pint/unsubscribe?token=example");
  expect(message.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
});
