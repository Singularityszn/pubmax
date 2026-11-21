import { beforeEach, describe, expect, it, vi } from "vitest";

const sources = vi.hoisted(() => ({ pubs: vi.fn(), drops: vi.fn(), community: vi.fn(), bundle: vi.fn(), aliases: vi.fn(), owner: vi.fn(), updates: vi.fn() }));
vi.mock("@/lib/ukBaseIndex", () => ({ lookupUkBasePubs: sources.pubs }));
vi.mock("@/lib/pintDropsStore", () => ({ pintDropsStore: () => ({ publicPricedVenueIds: sources.drops }) }));
vi.mock("@/lib/communityPriceStore", () => ({ communityPriceStore: () => ({ publicPricedVenueIds: sources.community }) }));
vi.mock("@/lib/ukPriceBundle.server", () => ({ ukPriceBundleRowsByVenue: sources.bundle }));
vi.mock("@/lib/venueAliases", () => ({ loadVenueAliasResolver: sources.aliases }));
vi.mock("@/lib/publicPricePresence.server", () => ({ readPublicPricePresence: sources.owner }));
vi.mock("@/lib/priceUpdates.server", () => ({ venuePriceUpdatesFor: sources.updates }));
import { readPublicBasePricePresence } from "@/lib/publicBasePricePresence.server";

beforeEach(() => {
  vi.resetAllMocks();
  sources.pubs.mockResolvedValue(new Map([["venue-uk-n1", { status: "ready", pub: { id: "venue-uk-n1", curatedVenueId: "", name: "Test", address: "", lat: 53, lng: -2 } }]]));
  sources.drops.mockResolvedValue(new Set());
  sources.community.mockResolvedValue(new Set());
  sources.bundle.mockResolvedValue({ status: "ready", byVenue: new Map() });
  sources.aliases.mockResolvedValue({ status: "ready", storedIds: (id: string) => [id] });
  sources.owner.mockResolvedValue({});
  sources.updates.mockResolvedValue({ drink: [], food: [] });
});

describe("base pub price presence", () => {
  it("confirms absence for a real base pub when every source answers", async () => {
    expect(await readPublicBasePricePresence(["venue-uk-n1"])).toEqual({ "venue-uk-n1": "absent" });
  });
  it("keeps an unread source unknown", async () => {
    sources.community.mockRejectedValue(new Error("unavailable"));
    expect(await readPublicBasePricePresence(["venue-uk-n1"])).toEqual({ "venue-uk-n1": "unknown" });
  });
  it("keeps an unavailable menu read unknown and honours a known community price", async () => {
    sources.updates.mockResolvedValue(null);
    expect(await readPublicBasePricePresence(["venue-uk-n1"])).toEqual({ "venue-uk-n1": "unknown" });
    sources.community.mockResolvedValue(new Set(["venue-uk-n1"]));
    expect(await readPublicBasePricePresence(["venue-uk-n1"])).toEqual({ "venue-uk-n1": "present" });
  });
  it("treats an estimate as an estimate, and a recorded row as present", async () => {
    sources.bundle.mockResolvedValue({ status: "ready", byVenue: new Map([["venue-uk-n1", [{ standing: "estimate" }]]]) });
    expect(await readPublicBasePricePresence(["venue-uk-n1"])).toEqual({ "venue-uk-n1": "absent" });
    sources.bundle.mockResolvedValue({ status: "ready", byVenue: new Map([["venue-uk-n1", [{ standing: "listed" }]]]) });
    expect(await readPublicBasePricePresence(["venue-uk-n1"])).toEqual({ "venue-uk-n1": "present" });
  });
  it("does not hide a recorded price on the curated owner", async () => {
    sources.pubs.mockResolvedValue(new Map([["venue-uk-n1", { status: "ready", pub: { id: "venue-uk-n1", curatedVenueId: "venue-owner", name: "Test", address: "", lat: 53, lng: -2 } }]]));
    sources.owner.mockResolvedValue({ "venue-owner": "present" });
    expect(await readPublicBasePricePresence(["venue-uk-n1"])).toEqual({ "venue-uk-n1": "present" });
  });
});
