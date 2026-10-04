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
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ overlay: null, placesContent }), { status: 200 })));
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(createElement(UnverifiedPubSheet, { pub, communityPrices })));
  const text = container.querySelector(".unverifiedPubLead")?.textContent;
  act(() => root.unmount());
  return text;
}

it("drops the all-we-know clause only once Google Places content has arrived", async () => {
  const record = placesEnrichmentRecord(pub.id, "ChIJVerified123", { formattedAddress: "1 High Street, London" }, new Date().toISOString());
  expect(await lead(record)).toBe("We know this pub is here. Nobody has logged what a drink costs - be the first.");
  expect(await lead(undefined)).toBe("We know this pub is here, and that is all we know. Nobody has logged what a drink costs - be the first.");
});
