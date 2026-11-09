// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import UnverifiedPubSheet from "@/components/map/UnverifiedPubSheet";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { placesEnrichmentRecord } from "@/lib/placesEnrichment";
import type { UkBasePub } from "@/lib/ukBasePubs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "signed-in-drinker" }, handle: "night_owl", identityResolved: true, loading: false, configured: true }),
}));

const pub: UkBasePub = { id: "venue-osm-n1", name: "The Test Arms", address: "1 Test Street", lat: 51.5, lng: -0.1, curatedVenueId: "", kind: "pub" };

const communityPrices = {
  byVenueId: new Map([[pub.id, []]]),
  signalsByVenueId: new Map(),
  freshestByVenueId: new Map(),
  noAlcoholIndexStatus: "idle",
  provisionalBaseVenueIds: new Set(),
  loadProvisionalBaseVenues: () => {},
  loadVenue: () => {},
  venuePriceStatus: new Map([[pub.id, "ready"]]),
  loadNoAlcoholIndex: () => {},
  loadDrinkCategoryIndex: () => {},
  drinkCategoryIndexStatus: new Map(),
  submit: async () => ({ ok: true, attribution: { status: "anonymous" }, price: null, pintTrust: null, confirmationOutcome: null }),
  submitVenueSignal: async () => ({ ok: true }),
  submitting: false,
  reportPrice: () => {},
  reportedIds: new Set<string>(),
} as unknown as CommunityPricesState;

afterEach(() => vi.unstubAllGlobals());

async function lead(placesContent: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ overlay: null, placesContent, listedPriceStatus: "empty" }), { status: 200 })));
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(createElement(UnverifiedPubSheet, { pub, communityPrices })));
  const text = container.querySelector(".unverifiedPubLead")?.textContent;
  act(() => root.unmount());
  return text;
}

it("drops the all-we-know clause only once Google Places content has arrived", async () => {
  const record = placesEnrichmentRecord(pub.id, "ChIJVerified123", { formattedAddress: "1 High Street, London" }, new Date().toISOString());
  expect(await lead(record)).toBe("We know this pub is here. Nobody has logged what a drink costs. Be the first.");
  expect(await lead(undefined)).toBe("We know this pub is here, and that is all we know. Nobody has logged what a drink costs. Be the first.");
});

it.each(["empty", "unavailable", "http-error", "network-error"])("waits for the listed read before absence: %s", async (result) => {
  let finish!: (response: Response) => void;
  let fail!: (error: Error) => void;
  const pending = new Promise<Response>((resolve, reject) => { finish = resolve; fail = reject; });
  vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/harvest-overlay?")
    ? pending : Promise.resolve(new Response("{}"))));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(UnverifiedPubSheet, { pub, communityPrices })));
    expect(container.querySelector(".unverifiedPubTag")?.textContent).not.toContain("No price yet");
    expect(container.querySelector(".unverifiedPubLead")).toBeNull();
    await act(async () => {
      if (result === "network-error") fail(new Error("offline"));
      else finish(new Response(JSON.stringify({ overlay: null, listedPriceStatus: result }), { status: result === "http-error" ? 503 : 200 }));
    });
    expect(container.querySelector(".unverifiedPubTag")?.textContent).toContain(result === "empty" ? "No price yet" : "Prices unread");
    expect(container.querySelector(".unverifiedPubLead")?.textContent).toContain(result === "empty" ? "Nobody has logged" : "could not read");
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps a listed price despite degraded metadata and clears it for another pub", async () => {
  const listedPrice = { priceGbp: 6.5, publisher: "Guinndex", sourceUrl: "https://guinndex.co.uk/pub/the-pub-london", observedAt: new Date().toISOString() };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "degraded", overlay: null, listedPriceStatus: "ready", listedPrice }))));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(UnverifiedPubSheet, { pub, communityPrices })));
    expect(container.textContent).toContain("£6.50");
    expect(container.querySelector(".unverifiedPubTag")?.textContent).toContain("Published price");
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const nextPub = { ...pub, id: "venue-osm-n2" };
    const nextPrices = { ...communityPrices, venuePriceStatus: new Map([[nextPub.id, "ready" as const]]) };
    await act(async () => root.render(createElement(UnverifiedPubSheet, { pub: nextPub, communityPrices: nextPrices })));
    expect(container.textContent).not.toContain("£6.50");
    expect(container.querySelector(".unverifiedPubTag")?.textContent).not.toContain("No price yet");
  } finally {
    await act(async () => root.unmount());
  }
});
