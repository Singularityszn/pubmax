import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const venueState = vi.hoisted(() => ({
  read: vi.fn(),
}));

const ENABLED_CITIES = [
  "london",
  "manchester",
  "liverpool",
  "oxford",
  "durham",
  "glasgow",
  "bristol",
  "cambridge",
  "bath",
  "llandudno",
];

vi.mock("@/lib/venueIndex", () => ({
  getVenueIndexSnapshot: venueState.read,
}));

function snapshot(loadedCities: string[] = ENABLED_CITIES) {
  return {
    index: new Map([
      [
        "venue-london-1",
        { id: "venue-london-1", name: "The Lexington", borough: "Islington", lat: 51.5326, lng: -0.1119 },
      ],
      [
        "venue-mcr-1lwo5lo",
        { id: "venue-mcr-1lwo5lo", name: "The Lexington", borough: "Manchester", lat: 53.48, lng: -2.24 },
      ],
    ]),
    loadedCities: new Set(loadedCities),
    complete: loadedCities.length === ENABLED_CITIES.length,
  };
}

async function loadIndex() {
  vi.resetModules();
  return import("@/lib/out/venueMatch.server");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadOutVenueMatchIndex", () => {
  it("shares one in-flight snapshot and resolver build", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    venueState.read.mockImplementation(async () => {
      await gate;
      return snapshot();
    });
    const { loadOutVenueMatchIndex } = await loadIndex();

    const first = loadOutVenueMatchIndex("london");
    const second = loadOutVenueMatchIndex("london");
    expect(venueState.read).toHaveBeenCalledTimes(1);
    release();

    const [firstIndex, secondIndex] = await Promise.all([first, second]);
    expect(firstIndex).toBe(secondIndex);
    expect(firstIndex).not.toBeNull();
  });

  it("clears a rejected in-flight read and retries", async () => {
    venueState.read.mockRejectedValueOnce(new Error("index read failed")).mockResolvedValue(snapshot());
    const { loadOutVenueMatchIndex } = await loadIndex();

    await expect(loadOutVenueMatchIndex("london")).rejects.toThrow("index read failed");
    await expect(loadOutVenueMatchIndex("london")).resolves.not.toBeNull();
    expect(venueState.read).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable for a missing request city without using another city's rows", async () => {
    venueState.read.mockResolvedValue(snapshot(["london"]));
    const { loadOutVenueMatchIndex } = await loadIndex();

    await expect(loadOutVenueMatchIndex("manchester")).resolves.toBeNull();
    const london = await loadOutVenueMatchIndex("london");
    expect(london?.byNormalizedName.get("lexington")).toEqual([
      expect.objectContaining({ venueId: "venue-london-1" }),
    ]);
  });
});
