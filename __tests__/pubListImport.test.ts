import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { importPubList } from "@/lib/pubListImport.server";

describe("pub list import", () => {
  beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", ""));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses no model for a deterministic list even when every pub is unmatched", async () => {
    const extract = vi.fn().mockRejectedValue(new Error("The model must not run."));
    const text = Array.from({ length: 21 }, (_, i) => `${i + 1}. Unknown pub ${i + 1}`).join("\n");
    const { items } = await importPubList({ text }, { curated: [], national: [] }, extract);

    expect(items).toHaveLength(21);
    expect(items.every((item) => item.state === "unmatched")).toBe(true);
    expect(extract).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "[{\"name\":\"The Harp\",\"areaHint\":\"\"}]",
    { name: "The Harp", areaHint: "" },
    [{ name: "The Harp" }],
    [{ name: 123, areaHint: "" }],
    [{ name: "The Harp", areaHint: null }],
    [{ name: "   ", areaHint: "" }],
    [{ name: "x".repeat(4001), areaHint: "" }],
    Array.from({ length: 41 }, () => ({ name: "The Harp", areaHint: "" })),
    [],
    [{ name: "The Invented Arms", areaHint: "" }],
  ])("retains the original unmatched line when fallback output is unusable: %j", async (output) => {
    const input = { text: "Try The Harp tonight." };
    const catalog = { curated: [], national: [] };
    const deterministic = await importPubList(input, catalog);

    expect(await importPubList(input, catalog, async () => output)).toEqual(deterministic);
  });

  it("keeps model errors and pasted text out of logs while retaining an unmatched line", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await importPubList({ text: "Meet at The Harp, private group note." }, {
      curated: [], national: [],
    }, async () => { throw new Error("Private provider response."); });

    expect(result.items).toMatchObject([{ name: "Meet at The Harp", state: "unmatched" }]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("restores pasted order, removes model duplicates, and keeps unknown names and closed national pubs", async () => {
    const text = "Try THE KING’S ARMS then The Mystery Door then The Blue Bell.";
    const { items } = await importPubList({ text }, {
      curated: [{ id: "kings", name: "Kings Arms", area: "London" }],
      national: [{ id: "blue", name: "The Blue Bell", area: "York", closed: true }],
    }, async () => [
      { name: "The Blue Bell", areaHint: "" },
      { name: "the king's arms", areaHint: "" },
      { name: "The Mystery Door", areaHint: "" },
      { name: "THE KING’S ARMS", areaHint: "" },
    ]);

    expect(items.map((item) => item.state)).toEqual(["matched", "unmatched", "closed"]);
    expect(items.map((item) => item.name)).toEqual(["the king's arms", "The Mystery Door", "The Blue Bell"]);
    expect(items[2]).toMatchObject({ venue: { layer: "national", price: null, closed: true } });
    expect(items.every((item) => item.rawLine === text)).toBe(true);
  });

  it("accepts actual area words but rejects a name embedded inside another word", async () => {
    const { items } = await importPubList({ text: "Visit The Crown in Richmond then The Harpoon." }, {
      curated: [
        { id: "soho", name: "The Crown", area: "Soho" },
        { id: "richmond", name: "The Crown", area: "Richmond" },
      ], national: [],
    }, async () => [
      { name: "The Crown", areaHint: "Richmond", venueId: "soho" },
      { name: "The Harp", areaHint: "" },
    ]);

    expect(items).toMatchObject([{ name: "The Crown", state: "matched", venue: { id: "richmond" } }]);
    expect(items[0]).not.toHaveProperty("venueId");
  });

  it("gives the adapter only text and never fetches the attribution URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No requests allowed."));
    const extract = vi.fn().mockResolvedValue([{ name: "The Harp", areaHint: "" }]);
    await importPubList({ text: "Try The Harp tonight.", sourceUrl: "https://example.org/private/post" }, {
      curated: [], national: [],
    }, extract);

    expect(extract).toHaveBeenCalledExactlyOnceWith("Try The Harp tonight.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid input before invoking a model", async () => {
    const extract = vi.fn();
    const catalog = { curated: [], national: [] };

    await expect(importPubList({ text: "x".repeat(4001) }, catalog, extract)).rejects.toThrow(RangeError);
    await expect(importPubList({ text: "The Harp", sourceUrl: "http://localhost" }, catalog, extract))
      .rejects.toThrow(RangeError);
    await expect(importPubList({ text: "" }, catalog, extract)).rejects.toThrow(RangeError);
    expect(extract).not.toHaveBeenCalled();
  });

  it("keeps a known deterministic pub when the model omits it", async () => {
    const { items } = await importPubList({ text: "The Harp, near The Crown" }, {
      curated: [{ id: "harp", name: "The Harp", area: "Covent Garden" }], national: [],
    }, async () => [{ name: "The Crown", areaHint: "" }]);

    expect(items).toMatchObject([{ name: "The Harp", state: "matched", venue: { id: "harp" } }]);
  });

  it("extracts names from prose but drops a model's invented pub", async () => {
    const { items } = await importPubList({ text: "Try The Harp and then The Crown tonight." }, {
      curated: [
        { id: "harp", name: "The Harp", area: "Covent Garden" },
        { id: "crown-soho", name: "The Crown", area: "Soho" },
        { id: "crown-richmond", name: "The Crown", area: "Richmond" },
        { id: "invented", name: "The Invented Arms", area: "London" },
      ],
      national: [],
    }, async () => [
      { name: "The Harp", areaHint: "" },
      { name: "The Crown", areaHint: "Richmond" },
      { name: "The Invented Arms", areaHint: "" },
    ]);

    expect(items.map((item) => item.name)).toEqual(["The Harp", "The Crown"]);
    expect(items[0]).toMatchObject({ state: "matched", venue: { id: "harp" } });
    expect(items[1]).toMatchObject({ state: "ambiguous", areaHint: "" });
  });

  it("credits a supplied TikTok link without fetching the post", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No requests allowed."));
    const result = await importPubList({
      text: "The Harp\nThe Crown",
      sourceUrl: "https://www.tiktok.com/@london.pubs/video/123456",
    }, { curated: [], national: [] });

    expect(result.source).toEqual({
      url: "https://www.tiktok.com/@london.pubs/video/123456",
      platform: "tiktok",
      handle: "@london.pubs",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.items.map((item) => item.name)).toEqual(["The Harp", "The Crown"]);
  });

  it.each([
    ["https://www.instagram.com/london.pubs/", "@london.pubs"],
    ["https://www.instagram.com/london.pubs/reel/ABC123/", "@london.pubs"],
    ["https://www.instagram.com/p/ABC123/", null],
    ["https://www.instagram.com/reel/ABC123/", null],
    ["https://www.instagram.com/explore/", null],
  ])("credits Instagram without inventing a creator absent from the path: %s", async (sourceUrl, handle) => {
    const result = await importPubList({ text: "The Harp", sourceUrl }, { curated: [], national: [] });

    expect(result.source).toEqual({ url: sourceUrl, platform: "instagram", handle });
  });

  it.each([
    "https://vm.tiktok.com/ABC123/",
    "https://vt.tiktok.com/ABC123/",
    "https://vm.tiktok.com/@invented/video/123",
    "https://www.tiktok.com/t/ABC123/",
  ])("keeps short TikTok attribution without following redirects or guessing a handle: %s", async (sourceUrl) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No requests allowed."));
    const result = await importPubList({ text: "The Harp", sourceUrl }, { curated: [], national: [] });

    expect(result.source).toEqual({ url: sourceUrl, platform: "tiktok", handle: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    "not a link",
    "http://example.com/post",
    "javascript:alert(1)",
    "https://user:secret@example.com/post",
    "https://localhost/post",
    "https://localhost./post",
    "https://pub.local/post",
    "https://pub.internal/post",
    "https://127.0.0.1/post",
    "https://2130706433/post",
    "https://10.1.2.3/post",
    "https://192.168.1.2/post",
    "https://169.254.169.254/post",
    "https://100.64.0.1/post",
    "https://[::1]/post",
    "https://[::ffff:169.254.169.254]/post",
    "https://[fd00::1]/post",
  ])("refuses unsafe source links without returning their contents or making requests: %s", async (sourceUrl) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No requests allowed."));

    await expect(importPubList({ text: "The Harp", sourceUrl }, { curated: [], national: [] }))
      .rejects.toThrow(new RangeError("Use a public HTTPS source link without credentials."));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "  "])("allows an import without source attribution: %j", async (sourceUrl) => {
    const result = await importPubList({ text: "The Harp", sourceUrl }, { curated: [], national: [] });

    expect(result.source).toBeNull();
    expect(result.items[0]).toMatchObject({ name: "The Harp", state: "unmatched" });
  });

  it.each([
    "https://tiktok.com.example.org/@somebody/video/123",
    "https://example.org/instagram.com/@somebody",
    "https://example.org/note",
  ])("keeps other public sources without claiming social platform attribution: %s", async (sourceUrl) => {
    const result = await importPubList({ text: "The Harp", sourceUrl }, { curated: [], national: [] });

    expect(result.source).toEqual({ url: sourceUrl, platform: "other", handle: null });
  });

  it("keeps the pasted order and an unknown pub through the import entry point", async () => {
    const result = await importPubList({ text: "1. The Harp, Covent Garden\n2. The Imaginary Teapot" }, {
      curated: [{ id: "harp", name: "The Harp", area: "Covent Garden" }],
      national: [],
    });

    expect(result.items).toEqual([
      {
        rawLine: "1. The Harp, Covent Garden",
        name: "The Harp",
        areaHint: "Covent Garden",
        state: "matched",
        venue: { id: "harp", name: "The Harp", area: "Covent Garden", layer: "curated" },
      },
      {
        rawLine: "2. The Imaginary Teapot",
        name: "The Imaginary Teapot",
        areaHint: "",
        state: "unmatched",
      },
    ]);
  });

  it("keeps The Crown ambiguous and uses an area or postcode district only to break ties", async () => {
    const catalog = {
      curated: [
        { id: "crown-soho", name: "The Crown", area: "Soho", postcodeDistrict: "W1D" },
        { id: "crown-richmond", name: "The Crown", area: "Richmond", postcodeDistrict: "TW9" },
      ],
      national: [],
    };
    const { items } = await importPubList({ text: "The Crown\nThe Crown, Richmond\nThe Crown (W1D)\nThe Crown, Camden" }, catalog);

    expect(items[0]).toMatchObject({ state: "ambiguous", candidates: [{ id: "crown-soho" }, { id: "crown-richmond" }] });
    expect(items[0]).not.toHaveProperty("venue");
    expect(items[1]).toMatchObject({ state: "matched", venue: { id: "crown-richmond" } });
    expect(items[2]).toMatchObject({ state: "matched", venue: { id: "crown-soho" } });
    expect(items[3]).toMatchObject({ state: "ambiguous" });
  });

  it("does not turn a partial postcode district into a tie breaker", async () => {
    const { items } = await importPubList({ text: "The Crown, W1" }, {
      curated: [
        { id: "crown-soho", name: "The Crown", area: "Soho", postcodeDistrict: "W1D" },
        { id: "crown-richmond", name: "The Crown", area: "Richmond", postcodeDistrict: "TW9" },
      ],
      national: [],
    });

    expect(items[0]).toMatchObject({ state: "ambiguous" });
  });

  it("limits ambiguous suggestions without resolving an overloaded name", async () => {
    const { items } = await importPubList({ text: "The Crown" }, {
      curated: ["Soho", "Richmond", "Camden", "Hackney", "Brixton"].map((area) => ({ id: area, name: "The Crown", area })),
      national: [],
    });

    expect(items[0]).toMatchObject({ state: "ambiguous", candidateCount: 5 });
    const item = items[0];
    if (item?.state !== "ambiguous") throw new Error("Expected an ambiguous pub.");
    expect(item.candidates).toHaveLength(4);
    expect(items[0]).not.toHaveProperty("venue");
  });

  it.each([
    "The Harp, Covent Garden\nThe Crown - Soho\nThe George (Southwark)",
    "1. The Harp, Covent Garden 2. The Crown - Soho 3. The George (Southwark)",
    "• The Harp, Covent Garden • The Crown - Soho • The George (Southwark)",
    "🍺 The Harp, Covent Garden 🍻 The Crown - Soho 📍 The George (Southwark)",
    "- The Harp, Covent Garden\r\n* The Crown - Soho\r\n▪ The George (Southwark)",
    "1️⃣ The Harp, Covent Garden\n2️⃣ The Crown - Soho\n3️⃣ The George (Southwark)",
  ])("extracts ordered names and area hints from a pasted list: %s", async (text) => {
    const { items } = await importPubList({ text }, { curated: [], national: [] });

    expect(items.map(({ name, areaHint }) => ({ name, areaHint }))).toEqual([
      { name: "The Harp", areaHint: "Covent Garden" },
      { name: "The Crown", areaHint: "Soho" },
      { name: "The George", areaHint: "Southwark" },
    ]);
    expect(items.every((item) => item.state === "unmatched")).toBe(true);
  });

  it("reports truncation rather than silently losing candidates past the 40 item limit", async () => {
    const text = Array.from({ length: 41 }, (_, i) => `${i + 1}. Unknown pub ${i + 1}`).join("\n");
    const result = await importPubList({ text }, { curated: [], national: [] });

    expect(result.items).toHaveLength(40);
    expect(result.items[39]?.name).toBe("Unknown pub 40");
    expect(result.truncated).toBe(true);
  });

  it.each(["", " \n\t", "🍺\n•\n-"])("refuses text without a candidate: %j", async (text) => {
    await expect(importPubList({ text }, { curated: [], national: [] })).rejects.toThrow("Paste at least one pub name.");
  });

  it("refuses overlong input without putting the pasted text into the error", async () => {
    await expect(importPubList({ text: "x".repeat(4001) }, { curated: [], national: [] }))
      .rejects.toThrow("The pub list must contain 4,000 characters or fewer.");
    expect((await importPubList({ text: "x".repeat(4000) }, { curated: [], national: [] })).items).toHaveLength(1);
  });

  it("keeps national matches unpriced and does not copy extra catalog fields", async () => {
    const nationalVenue = {
      id: "osm-york", name: "The Blue Bell", area: "York", cheapestPrice: 1, creatorClaim: "Open all night",
    };
    const { items } = await importPubList({ text: "The Blue Bell, York" }, { curated: [], national: [nationalVenue] });

    expect(items[0]).toEqual({
      rawLine: "The Blue Bell, York", name: "The Blue Bell", areaHint: "York", state: "matched",
      venue: { id: "osm-york", name: "The Blue Bell", area: "York", layer: "national", price: null, hasPrice: false },
    });
  });

  it("marks closed pubs separately from matched pubs in either layer", async () => {
    const { items } = await importPubList({ text: "The Shut Door\nThe Closed Bell" }, {
      curated: [{ id: "shut", name: "The Shut Door", area: "Soho", closed: true }],
      national: [{ id: "closed", name: "The Closed Bell", area: "York", closed: true }],
    });

    expect(items.map((item) => item.state)).toEqual(["closed", "closed"]);
    expect(items[1]).toMatchObject({ venue: { layer: "national", price: null } });
  });

  it("exposes known closure on ambiguous candidates before the reader chooses", async () => {
    const { items } = await importPubList({ text: "The Crown" }, {
      curated: [
        { id: "open", name: "The Crown", area: "Soho" },
        { id: "closed", name: "The Crown", area: "Richmond", closed: true },
      ],
      national: [],
    });

    expect(items[0]).toMatchObject({ state: "ambiguous", candidates: [{ id: "open" }, { id: "closed", closed: true }] });
  });

  it("uses the curated layer first without treating its duplicate national record as another choice", async () => {
    const { items } = await importPubList({ text: "Harp" }, {
      curated: [{ id: "harp", name: "The Harp", area: "Covent Garden" }],
      national: [{ id: "osm-harp", name: "The Harp", area: "Covent Garden" }],
    });

    expect(items[0]).toMatchObject({ state: "matched", venue: { id: "harp", layer: "curated" } });
  });

  it("does not replace an ambiguous curated name with a unique national match", async () => {
    const { items } = await importPubList({ text: "Crown" }, {
      curated: [
        { id: "crown-soho", name: "The Crown", area: "Soho" },
        { id: "crown-richmond", name: "The Crown", area: "Richmond" },
      ],
      national: [{ id: "osm-crown", name: "The Crown", area: "York" }],
    });

    expect(items[0]).toMatchObject({ state: "ambiguous", candidateCount: 2 });
  });

  it.each([
    ["cheshire cheese", "Ye Olde Cheshire Cheese"],
    ["THE KING’S ARMS", "Kings Arms"],
    ["Coach & Horses", "The Coach and Horses"],
    ["St. John's", "St Johns"],
  ])("matches spelling variants %s and %s without fuzzy guesses", async (text, name) => {
    const { items } = await importPubList({ text }, { curated: [{ id: "pub", name, area: "London" }], national: [] });

    expect(items[0]).toMatchObject({ state: "matched", venue: { id: "pub" } });
  });

  it("retains duplicate pasted items while deduplicating repeated catalog identities", async () => {
    const venue = { id: "harp", name: "The Harp", area: "Covent Garden" };
    const { items } = await importPubList({ text: "The Harp\nThe Harp" }, { curated: [venue, venue], national: [] });

    expect(items.map((item) => item.state)).toEqual(["matched", "matched"]);
  });
});

it("uses a named national area before a London namesake without that area", async () => {
  const catalog = {
    curated: [{ id: "london-blackfriar", name: "The Blackfriar", area: "City of London" }],
    national: [{ id: "salford-blackfriar", name: "The Blackfriar", area: "Salford" }],
  };
  const salford = await importPubList({ text: "The Blackfriar, Salford" }, catalog, async () => []);
  expect(salford.items[0]).toMatchObject({ state: "matched", venue: { id: "salford-blackfriar", layer: "national", price: null } });
  const london = await importPubList({ text: "The Blackfriar, City of London" }, catalog, async () => []);
  expect(london.items[0]).toMatchObject({ state: "matched", venue: { id: "london-blackfriar", layer: "curated" } });
});
