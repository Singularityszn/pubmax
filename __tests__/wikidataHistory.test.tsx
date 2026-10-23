// @vitest-environment jsdom

// A PUB'S WIKIDATA HISTORY JOINS ON OSM'S OWN wikidata TAG, SAYS ONLY WHAT
// WIKIDATA RECORDS, AND NEVER BORROWS A BRAND'S (owner decision, 16 Oct 2026).
//
// public/data/osm_wikidata/london.json (OpenStreetMap, ODbL) says which item a
// London pub is; public/data/wikidata_history/london.json (Wikidata, CC0) holds
// that item's statements. lib/wikidataHistory.ts joins them, prints each through
// one closed template, links the exact statement and dates it. A missing link,
// item or pack answers nothing.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildOsmWikidataLinks, parseQid } from "@/scripts/lib/osmWikidataLinks.mjs";
import {
  buildWikidataHistoryPack,
  compactBinding,
  historyQuery,
  timeAtPrecision,
  wantedQids,
  wikidataSparqlRead,
} from "@/scripts/lib/wikidataHistoryPack.mjs";
import {
  parseOsmWikidataLinks,
  parseWikidataHistory,
  qidForVenueId,
  wikidataHistoryForVenue,
} from "@/lib/wikidataHistory";
import { heritageReadLabel, sanitizeHeritageFacts } from "@/lib/heritageFacts";
import VenueWikidataHistory from "@/components/map/VenueWikidataHistory";
import { READ_PHASE_DELAY_MS } from "@/lib/useStaggeredRead";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();
const FETCHED_AT = "2026-10-06T00:13:28.443Z";
const READ_AT = "2026-10-16T09:00:00.000Z";

function pub(type: string, id: number, tags: Record<string, string>, lat = 51.5, lon = -0.1) {
  return { type, id, lat, lon, tags: { amenity: "pub", ...tags } };
}

describe("the OSM link pack", () => {
  it("keeps one row per London pub naming an item no other London pub names", () => {
    const pack = buildOsmWikidataLinks({
      chunks: [
        {
          elements: [
            pub("node", 1, { name: "Prospect of Whitby", wikidata: "Q7250391" }),
            pub("node", 2, { name: "Chain A", wikidata: "Q100" }),
            pub("node", 3, { name: "Chain B", wikidata: "Q100" }),
            pub("node", 4, { name: "Branded", wikidata: "Q200", "brand:wikidata": "Q200" }),
            pub("node", 5, { name: "Bad", wikidata: "wikipedia:en" }),
            pub("node", 6, { name: "Leeds", wikidata: "Q300" }, 53.8, -1.55),
          ],
        },
      ],
      seedPubs: [{ osmId: "node/1", curatedRef: { source: "curated-london-slim", id: "venue-prospect" } }],
      fetchedAt: FETCHED_AT,
    });
    expect(pack.links).toEqual([["n1", "Q7250391", "venue-prospect"]]);
    expect(pack.counts).toMatchObject({ londonPubs: 5, tagged: 5, unreadableTag: 1, brandTag: 1, sharedItem: 2, linked: 1 });
    expect(pack).toMatchObject({ license: "ODbL 1.0", fetchedAt: FETCHED_AT });
    expect(parseQid(" Q42 ")).toBe("Q42");
    expect(parseQid("Q0")).toBeNull();
  });

  it("is committed exactly as the builder writes it from the committed snapshot", () => {
    const committed = JSON.parse(readFileSync(join(ROOT, "public/data/osm_wikidata/london.json"), "utf8"));
    const rawDir = join(ROOT, "data/osm/uk/raw");
    const rebuilt = buildOsmWikidataLinks({
      chunks: readdirSync(rawDir)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => JSON.parse(readFileSync(join(rawDir, file), "utf8"))),
      seedPubs: JSON.parse(readFileSync(join(ROOT, "data/osm/uk/uk_osm_pubs.json"), "utf8")).pubs,
      fetchedAt: JSON.parse(readFileSync(join(ROOT, "data/osm/uk/chunks.json"), "utf8")).generatedAt,
      venueAliases: JSON.parse(readFileSync(join(ROOT, "public/data/venue_id_aliases.json"), "utf8")).aliases,
    });
    expect(committed).toEqual(rebuilt);
    expect(committed.links.length).toBeGreaterThan(700);
    expect(wantedQids(committed).size).toBe(committed.links.length);
  });
});

function binding(qid: string, prop: string, value: string, extra: Record<string, string> = {}) {
  return {
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    prop: { value: prop },
    value: { value },
    ...Object.fromEntries(Object.entries(extra).map(([key, v]) => [key, { value: v }])),
  };
}

describe("the Wikidata history pack", () => {
  it("asks only for items Wikidata types as a pub and not as a brand, and never a deprecated date", () => {
    const query = historyQuery(["Q1", "Q2"]);
    expect(query).toContain("VALUES ?item { wd:Q1 wd:Q2 }");
    expect(query).toContain("?item wdt:P31/wdt:P279* wd:Q212198 .");
    expect(query).toContain("FILTER NOT EXISTS { ?item wdt:P31 wd:Q431289 . }");
    expect(query).toContain("FILTER(?rank != wikibase:DeprecatedRank)");
  });

  it("states a date at its own precision and never finer", () => {
    expect(timeAtPrecision("+1520-00-00T00:00:00Z", "9")).toBe("1520");
    expect(timeAtPrecision("+1520-06-01T00:00:00Z", "11")).toBe("1520");
    expect(timeAtPrecision("+1520-00-00T00:00:00Z", "8")).toBe("1520s");
    expect(timeAtPrecision("+1550-00-00T00:00:00Z", "7")).toBe("16th century");
    expect(timeAtPrecision("+1201-00-00T00:00:00Z", "7")).toBe("13th century");
    expect(timeAtPrecision("+1100-00-00T00:00:00Z", "6")).toBeNull();
    expect(timeAtPrecision("not a time", "9")).toBeNull();
  });

  it("keeps a labelled statement and drops one that names only an id", () => {
    expect(compactBinding(binding("Q1", "P1435", "x", { valueLabel: "Grade II listed building" }))).toEqual([
      "Q1",
      ["P1435", "Grade II listed building"],
    ]);
    expect(compactBinding(binding("Q1", "P84", "x", { valueLabel: "Q999" }))).toBeNull();
    expect(compactBinding(binding("Q1", "P17", "x", { valueLabel: "United Kingdom" }))).toBeNull();
  });

  it("keeps only the items London pubs name, in property order, once each", () => {
    const pack = buildWikidataHistoryPack({
      wanted: new Set(["Q1", "Q2"]),
      retrievedAt: READ_AT,
      bindings: [
        binding("Q1", "P1435", "x", { valueLabel: "Grade II listed building" }),
        binding("Q1", "P571", "+1520-00-00T00:00:00Z", { precision: "9" }),
        binding("Q1", "P571", "+1520-00-00T00:00:00Z", { precision: "9" }),
        binding("Q9", "P571", "+1700-00-00T00:00:00Z", { precision: "9" }),
      ],
    });
    expect(pack.items).toEqual({ Q1: [["P571", "1520"], ["P1435", "Grade II listed building"]] });
    expect(pack.counts).toEqual({ wanted: 2, withHistory: 1 });
    expect(pack).toMatchObject({ source: "Wikidata", license: "CC0 1.0", retrievedAt: READ_AT });
    expect(() => buildWikidataHistoryPack({ wanted: new Set(), bindings: [], retrievedAt: "" })).toThrow();
  });
});

describe("the builder's Wikidata reads", () => {
  const noSleep = vi.fn(async () => {});
  const ok = (bindings: unknown[]) => new Response(JSON.stringify({ results: { bindings } }), { status: 200 });

  it("asks only the query service, names itself, and refuses a redirect", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => ok([{ item: 1 }]));
    expect(await wikidataSparqlRead("SELECT 1", { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep })).toEqual([
      { item: 1 },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(new URL(url ?? "").origin + new URL(url ?? "").pathname).toBe("https://query.wikidata.org/sparql");
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>)["user-agent"]).toMatch(/^Pubmaxxing/);
  });

  it("waits out a 429 as the service asks, and gives up after a bounded number of attempts", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(ok([]));
    expect(await wikidataSparqlRead("SELECT 1", { fetchImpl, sleep })).toEqual([]);
    expect(sleep.mock.calls).toEqual([[3000]]);
    const throttled = vi.fn(async () => new Response("", { status: 503 }));
    await expect(wikidataSparqlRead("SELECT 1", { fetchImpl: throttled, sleep: noSleep, maxAttempts: 2 })).rejects.toThrow(
      /503 after 2 attempt/,
    );
    const refused = vi.fn(async () => new Response("", { status: 403 }));
    await expect(wikidataSparqlRead("SELECT 1", { fetchImpl: refused, sleep: noSleep })).rejects.toThrow(/403/);
    expect(refused).toHaveBeenCalledTimes(1);
  });
});

describe("the runtime join", () => {
  const links = parseOsmWikidataLinks({
    version: 1,
    fetchedAt: FETCHED_AT,
    links: [["n1", "Q7250391", "venue-prospect"], ["w2", "Q55", null], ["junk", "Q1", null]],
  });
  const history = parseWikidataHistory(
    buildWikidataHistoryPack({
      wanted: new Set(["Q7250391"]),
      retrievedAt: READ_AT,
      bindings: [
        binding("Q7250391", "P571", "+1520-00-00T00:00:00Z", { precision: "9" }),
        binding("Q7250391", "P1435", "x", { valueLabel: "Grade II* listed building" }),
      ],
    }),
  );

  it("reaches a curated pub by its link and a base pub by its own id", () => {
    expect(links && qidForVenueId("venue-prospect", links)).toBe("Q7250391");
    expect(links && qidForVenueId("venue-uk-n1", links)).toBe("Q7250391");
    expect(links && qidForVenueId("venue-other", links)).toBeNull();
    expect(wikidataHistoryForVenue("venue-prospect", links, history)).toEqual([
      {
        source: "wikidata",
        fact: "Inception recorded as 1520.",
        sourceRef: "https://www.wikidata.org/wiki/Q7250391#P571",
        observedAt: READ_AT,
      },
      {
        source: "wikidata",
        fact: "Heritage designation recorded as Grade II* listed building.",
        sourceRef: "https://www.wikidata.org/wiki/Q7250391#P1435",
        observedAt: READ_AT,
      },
    ]);
  });

  it("answers nothing, never a no, when a link, an item or a pack is missing", () => {
    expect(wikidataHistoryForVenue("venue-uk-w2", links, history)).toEqual([]);
    expect(wikidataHistoryForVenue("venue-other", links, history)).toEqual([]);
    expect(wikidataHistoryForVenue("venue-prospect", links, null)).toEqual([]);
    expect(wikidataHistoryForVenue("venue-prospect", null, history)).toEqual([]);
  });

  it("refuses a pack that is not one, or a statement it has no words for", () => {
    expect(parseWikidataHistory({ version: 1, retrievedAt: READ_AT, license: "CC BY-SA", items: {} })).toBeNull();
    const odd = parseWikidataHistory({
      version: 1,
      retrievedAt: READ_AT,
      license: "CC0 1.0",
      items: { Q1: [["P17", "United Kingdom"], ["P571", "1520"]], bad: [["P571", "1600"]] },
    });
    expect([...(odd?.byQid.entries() ?? [])]).toEqual([["Q1", [["P571", "1520"]]]]);
  });

  it("dates every fact for the sheet", () => {
    const [first] = sanitizeHeritageFacts(wikidataHistoryForVenue("venue-prospect", links, history));
    expect(heritageReadLabel(first?.observedAt)).toBe("read 16 Oct 2026");
  });
});

describe("the base pub sheet line", () => {
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function show(facts: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ facts }), { status: 200 })),
    );
    act(() => root.render(createElement(VenueWikidataHistory, { venueId: "venue-uk-n1", venueName: "Prospect of Whitby" })));
    await act(async () => {
      vi.advanceTimersByTime(READ_PHASE_DELAY_MS[2]);
      await Promise.resolve();
    });
    for (let i = 0; i < 6; i += 1) await act(async () => Promise.resolve());
  }

  it("prints only the dated, linked Wikidata statements, with the source and the read day", async () => {
    await show([
      { source: "nhle", fact: "Grade II* listed public house.", observedAt: READ_AT },
      // The name-keyed cache: undated, possibly another pub of the same name.
      { source: "wikidata", fact: "pub in Wapping, London" },
      {
        source: "wikidata",
        fact: "Inception recorded as 1520.",
        sourceRef: "https://www.wikidata.org/wiki/Q7250391#P571",
        observedAt: READ_AT,
      },
    ]);
    const items = [...container.querySelectorAll(".unverifiedPubHistory li")];
    expect(items.map((item) => item.textContent)).toEqual(["Inception recorded as 1520."]);
    expect(items[0]?.querySelector("a")?.getAttribute("href")).toBe("https://www.wikidata.org/wiki/Q7250391#P571");
    expect(container.querySelector(".unverifiedPubHistorySource")?.textContent).toBe("Wikidata (CC0), read 16 Oct 2026");
  });

  it("renders nothing when the packs hold no history for the pub", async () => {
    await show([{ source: "wikidata", fact: "pub in Wapping, London" }]);
    expect(container.innerHTML).toBe("");
  });
});

describe("the heritage read", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/wikidataHistory.server");
    vi.doUnmock("@/lib/serverEnv");
    vi.resetModules();
  });

  it("carries the exact Wikidata facts, dated, ahead of anything keyed by name", async () => {
    vi.resetModules();
    const exact = {
      source: "wikidata" as const,
      fact: "Inception recorded as 1520.",
      sourceRef: "https://www.wikidata.org/wiki/Q7250391#P571",
      observedAt: READ_AT,
    };
    const read = vi.fn(async (venueId: string) => (venueId === "venue-uk-n1" ? [exact] : []));
    vi.doMock("@/lib/wikidataHistory.server", () => ({ packWikidataHistoryForVenue: read }));
    vi.doMock("@/lib/serverEnv", () => ({ assertServerEnv: () => {}, assertProductionSecrets: () => {} }));
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { retrieveHeritageWithStatus } = await import("@/lib/heritage");

    const result = await retrieveHeritageWithStatus({ venueId: "venue-uk-n1", venueName: "Prospect of Whitby" });
    expect(read).toHaveBeenCalledWith("venue-uk-n1");
    expect(result.facts[0]).toEqual(exact);

    // No venue id, no exact join: the pack is not asked.
    read.mockClear();
    await retrieveHeritageWithStatus({ venueName: "Prospect of Whitby" });
    expect(read).not.toHaveBeenCalled();
  });
});
