// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PubComparisonResponse } from "@/lib/pubComparison";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => ({ user: null, handle: null, accountRevision: 0 }) }));

import PubComparisonResults from "@/components/tools/PubComparisonResults";

const result: PubComparisonResponse = {
  status: "ready", completeVenueCount: 1, meetingPoint: { id: "tower-bridge", name: "Tower Bridge" },
  venues: [{
    id: "venue-a", name: "The Crown", address: "1 Test Street", borough: "Islington",
    items: [{ requested: { category: "beer", drinkLabel: "Guinness", serving: "pint", quantity: 1 },
      status: "matched", reason: null, lineTotalPence: 500,
      evidence: { category: "beer", drinkLabel: "Guinness", serving: "pint", pricePence: 500,
        sourceClass: "listed", sourceKind: "directory", sourceUrl: "https://example.org/menu", publisher: "Example pub",
        date: "2026-10-01", dateMeaning: "source-read", eligible: true } }],
    knownSubtotalPence: 500, totalPence: 500,
    walk: { status: "routed", minutes: 5, method: "ors", timing: "shared-walking-pace" }, mapHref: "/map?sel=venue-a",
  }, {
    id: "venue-b", name: "The Crown", address: "2 Test Road", borough: "Islington",
    items: [{ requested: { category: "beer", drinkLabel: "Guinness", serving: "pint", quantity: 1 },
      status: "missing", reason: "Serving size not recorded.", lineTotalPence: null, evidence: null }],
    knownSubtotalPence: 0, totalPence: null,
    walk: { status: "unavailable", minutes: null, method: null, timing: null }, mapHref: "/map?sel=venue-b",
  }],
};

describe("comparison answer", () => {
  it("shows branch, serving, source and date while refusing an incomplete saving", () => {
    const html = renderToStaticMarkup(createElement(PubComparisonResults, { result }));
    expect(html).toContain("1 Test Street");
    expect(html).toContain("2 Test Road");
    expect(html).toContain("Guinness, pint");
    expect(html).toContain("Source read 1 Oct 2026");
    expect(html).toContain('href="https://example.org/menu"');
    expect(html).toContain("Known subtotal £0.00. Order incomplete.");
    expect(html).toContain("Serving size not recorded.");
    expect(html).toContain("walking comparison is unavailable");
    expect(html).not.toContain("Compared with The Crown");
    expect(html).not.toContain("Save £5");
  });

  it("offers public sharing without requiring an account or loading a map", () => {
    const html = renderToStaticMarkup(createElement(PubComparisonResults, { result }));
    expect(html).toContain("Share pub links");
    // Before the session answers, the page neither invites a sign-in nor
    // offers the private poll. __tests__/pubComparisonShare.test.tsx covers both.
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("Load my conversations");
    expect(html).toContain('href="/map?sel=venue-a"');
    expect(html).not.toContain("canvas");
    const textarea = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)?.[1];
    expect(textarea).not.toContain("Tower Bridge");
    expect(textarea).not.toContain("Guinness");
  });
});
