import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({
  assertServerEnv: () => {},
  assertProductionSecrets: () => {},
}));

import { POST } from "@/app/api/heritage/route";
import * as historic from "@/lib/historic";
import {
  answerHeritage,
  retrieveHeritage,
  storedFactSource,
} from "@/lib/heritage";
import { parseOverlayRow } from "@/lib/harvestFold";
import {
  __resetHarvestOverlayStore,
  harvestOverlayStore,
} from "@/lib/harvestOverlayStore";
import { currentFamousVenueIds } from "@/__tests__/helpers/currentFamousVenues";

// These tests run fully offline: no model, no Supabase, no network.
// They pin two guarantees:
//  1. An answer only ever repeats the facts we retrieved, and says so honestly
//     when there are none.
//  2. The trust boundary: ALL facts come from server-side stores
//     (heritage_cache.json + Supabase, keyed by normalised name). The route no
//     longer accepts a client `context` object, so a forged one is ignored.
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetHarvestOverlayStore();
});

// A malicious client trying to forge "sourced" pub history via a context object
// the API no longer accepts.
const FORGED_CONTEXT = {
  era: "Tudor 1520",
  heritageNote: "Secret Roman haunted crypt beneath the bar since AD 60.",
};

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/heritage", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

const SOURCED_SOURCES = new Set(["osm", "wikidata", "wikipedia", "seed"]);

describe("retrieveHeritage — trust boundary", () => {
  it("reads a repeated fact once while keeping both source citations", async () => {
    const cacheFact = "The Black Friar was built about 1875.";
    const [record] = await historic.loadHistoricPubs();
    if (!record) throw new Error("The heritage fixture is missing.");
    const read = vi.spyOn(historic, "loadHistoricPubs").mockResolvedValueOnce([{
      ...record,
      venueId: "venue-eltcmh",
      facts: [
        { source: "wikipedia", fact: cacheFact, sourceRef: "https://example.org/history" },
        { source: "seed", fact: ` ${cacheFact} `, sourceRef: "https://example.org/archive" },
      ],
    }]);
    try {
      const result = await answerHeritage({ venueName: "The Blackfriar", question: "Tell me about this pub" });
      expect(result.answer.match(/built about 1875/g)).toHaveLength(1);
      expect(result.citations).toEqual([
        { source: "wikipedia", ref: "https://example.org/history" },
        { source: "seed", ref: "https://example.org/archive" },
      ]);
    } finally {
      read.mockRestore();
    }
  });

  it("rejects unknown stored source labels instead of relabelling them", () => {
    expect(storedFactSource("webbing")).toBeNull();
    expect(storedFactSource("web ")).toBeNull();
    expect(storedFactSource("seed")).toBe("seed");
  });

  it("ignores a forged client context entirely (context is no longer accepted)", async () => {
    const facts = await retrieveHeritage({
      // "Nowhere Tavern" has no server facts, so with context ignored there are none.
      venueName: "Nowhere Tavern",
      // @ts-expect-error — context is no longer part of the input type; a client
      // that still sends it must be ignored.
      context: FORGED_CONTEXT,
    });
    // The forged claim never becomes a fact...
    expect(facts.some((f) => f.fact.includes("Roman haunted crypt"))).toBe(false);
    // ...and no fact is anything but a server-sourced source (there are none here).
    expect(facts).toHaveLength(0);
    for (const fact of facts) {
      expect(SOURCED_SOURCES.has(fact.source)).toBe(true);
    }
  });

  it("reads server cache facts back as sourced", async () => {
    const facts = await retrieveHeritage({ venueName: "Prospect of Whitby" });
    const sourced = facts.filter((f) => SOURCED_SOURCES.has(f.source));
    expect(sourced.length).toBeGreaterThanOrEqual(2);
    // The shipped seed/wikipedia cache facts are present and trusted.
    expect(sourced.some((f) => f.source === "seed")).toBe(true);
    expect(facts.some((f) => f.fact.includes("Grade II* listed"))).toBe(true);
  });

  it("does not combine caller name facts with an OSM-specific request", async () => {
    const facts = await retrieveHeritage({
      venueId: "node/123",
      venueName: "Prospect of Whitby",
    });

    expect(facts.some((fact) => fact.fact.includes("Grade II* listed"))).toBe(false);
    expect(facts.some((fact) => fact.fact.includes("1520"))).toBe(false);
  });

  it("uses the resolved venue name for legacy facts", async () => {
    const facts = await retrieveHeritage({
      venueId: "venue-16pnwmm",
      venueName: "Nowhere Tavern",
    });

    expect(facts.some((fact) => fact.fact.includes("1520"))).toBe(true);
  });

  it("attaches cited harvest lore by OSM venue id, never by pub name", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "node/123",
        name: "The Red Lion",
        town: "Clapham",
        website: "https://redlion.example/",
        matchedLore: {
          text: "The Red Lion in Clapham has stood on the common since the eighteenth century.",
          citations: ["https://history.example/red-lion-clapham"],
        },
        sources: ["https://redlion.example/"],
      }),
    ]);
    const byId = await retrieveHeritage({
      venueId: "venue-uk-n123",
      venueName: "Nowhere Tavern",
    });
    expect(byId.some((f) => f.source === "web")).toBe(true);
    expect(byId.some((f) => f.sourceRef === "https://history.example/red-lion-clapham")).toBe(
      true,
    );

    const byName = await retrieveHeritage({ venueName: "The Red Lion" });
    expect(byName.some((f) => f.source === "web")).toBe(false);
  });

  it("resolves salted city venue ids before reading harvest lore", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "way/100646638",
        name: "Peveril of the Peak",
        town: "Manchester",
        matchedLore: {
          text: "Peveril of the Peak in Manchester has a long history.",
          citations: ["https://history.example/peveril"],
        },
        sources: ["https://history.example/peveril"],
      }),
    ]);
    const facts = await retrieveHeritage({
      venueId: "venue-mcr-1lwo5lo",
      venueName: "Peveril of the Peak",
    });
    expect(facts.some((fact) => fact.source === "web")).toBe(true);
  });

  it("reads lore from every OSM object owned by one curated venue", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "node/13235500301",
        name: "The Grenadier",
        town: "London",
        matchedLore: {
          text: "The Grenadier in London has a story about its first mapped object.",
          citations: ["https://history.example/grenadier-node"],
        },
        sources: ["https://history.example/grenadier-node"],
      }),
      parseOverlayRow({
        osmId: "way/556177108",
        name: "The Grenadier",
        town: "London",
        matchedLore: {
          text: "The Grenadier in London has a story about its second mapped object.",
          citations: ["https://history.example/grenadier-way"],
        },
        sources: ["https://history.example/grenadier-way"],
      }),
    ]);

    const facts = await retrieveHeritage({
      venueId: "venue-1ha28jc",
      venueName: "The Grenadier",
    });
    expect(facts.filter((fact) => fact.source === "web").map((fact) => fact.sourceRef)).toEqual([
      "https://history.example/grenadier-node",
      "https://history.example/grenadier-way",
    ]);
  });
});

describe("answerHeritage (no key — grounded only)", () => {
  it("ignores a forged client context — no contributor fact or citation appears", async () => {
    const res = await answerHeritage({
      venueName: "Nowhere Tavern",
      question: "How old is this pub?",
      // @ts-expect-error — context is no longer accepted by the API.
      context: FORGED_CONTEXT,
    });
    // With no server facts and context ignored, it falls back to the honest line.
    expect(res.answer).toContain("no fuller story on record");
    // The forged content is never echoed and there is no contributor citation.
    expect(res.answer).not.toContain("Roman");
    expect(res.citations).toHaveLength(0);
    expect(res.citations.some((c) => c.source === "contributor")).toBe(false);
  });

  it("cites server facts as sourced", async () => {
    const res = await answerHeritage({
      venueName: "Prospect of Whitby",
      question: "How old is this pub?",
    });
    expect(res.answer).toContain("1520");
    expect(res.answer).not.toContain("Roman");
    expect(res.citations.some((c) => SOURCED_SOURCES.has(c.source))).toBe(true);
  });

  it("says it has no fuller story when there are zero facts", async () => {
    const res = await answerHeritage({
      venueName: "Nowhere Tavern",
      question: "What's the story here?",
    });
    expect(res.answer).toContain("no fuller story on record");
    expect(res.citations).toHaveLength(0);
  });

  it("uses kind-honest clarification copy for a late-food venue", async () => {
    const res = await answerHeritage({
      venueName: "Nowhere Kitchen",
      venueKind: "food",
      question: "What's the story here?",
    });

    expect(res.clarifyingQuestion).toBe(
      "What would you like to know about this late-food venue?",
    );
  });
});

describe("POST /api/heritage", () => {
  it("rejects a missing venueName with 400", async () => {
    const res = await post({ question: "How old is this pub?" });
    expect(res.status).toBe(400);
  });

  it("returns a grounded 200 backed by server facts", async () => {
    const res = await post({
      venueName: "Prospect of Whitby",
      question: "How old is this pub?",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toContain("1520");
  });

  it("resolves venue name and kind server-side when an id is supplied", async () => {
    const res = await post({
      venueId: "food-best-turkish-kebab",
      venueName: "Prospect of Whitby",
      question: "What's the story here?",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).not.toContain("1520");
    // A lapsed famous row is withheld from the slim index, so the id no
    // longer resolves and the kind falls back to a pub.
    expect(body.clarifyingQuestion).toBe(
      currentFamousVenueIds().has("food-best-turkish-kebab")
        ? "What would you like to know about this late-food venue?"
        : "What would you like to know about this pub?",
    );
  });

  it("caps an oversized venueName so a hostile client can't blow up retrieval", async () => {
    // 5 kB of garbage. The route must accept the request (still a 200 — the
    // demo never 500s), and the truncated normalised name matches no server
    // facts, so we get the honest empty-line answer.
    const padded = "Some Pub " + "x".repeat(5_000);
    const res = await post({ venueName: padded, question: "How old is this pub?" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.answer).toBe("string");
    // No server facts match a mangled 5 kB name → honest empty-line fallback.
    expect(body.answer).toContain("no fuller story on record");
    // And there are no citations for a name that doesn't resolve.
    expect(body.citations).toHaveLength(0);
  });

  it("ignores a forged `context` in the request body", async () => {
    // A client that still POSTs `context` must not have it echoed as history.
    const res = await post({
      venueName: "Nowhere Tavern",
      question: "How old is this pub?",
      context: FORGED_CONTEXT,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toContain("no fuller story on record");
    expect(body.answer).not.toContain("Roman");
    expect(body.citations).toHaveLength(0);
  });
});

// The Landlord calls no model: the stored facts answer, whatever model keys
// the deployment holds.
describe("The Landlord without a model", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers from the stored facts and sends nothing to any provider", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const network = vi.fn(async () => {
      throw new Error("The Landlord must not reach the network.");
    });
    vi.stubGlobal("fetch", network);

    const res = await answerHeritage({ venueName: "Prospect of Whitby", question: "How old is this pub?" });

    expect(res.answer).toContain("Here's what's on record");
    expect(res.answer).toContain("1520");
    expect(network).not.toHaveBeenCalled();
  });
});
