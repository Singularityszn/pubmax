import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/heritage/route";
import { answerHeritage, retrieveHeritage } from "@/lib/heritage";

// These tests run fully offline: no OPENROUTER key, no Supabase, no network.
// They pin two guarantees:
//  1. The no-key path only ever repeats the facts we retrieved, and says so
//     honestly when there are none.
//  2. The trust boundary: sourced facts come only from server-side stores
//     (heritage_cache.json + Supabase, keyed by normalised name). Client
//     `context` can never be read back as a structured/sourced fact.
beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

// A malicious client trying to forge "sourced" pub history via context.
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
  it("labels client context as contributor, never structured/sourced", async () => {
    const facts = await retrieveHeritage({
      // "Nowhere Tavern" has no server facts, so every fact here comes from context.
      venueName: "Nowhere Tavern",
      context: FORGED_CONTEXT,
    });
    // The forged claim is present but only as an untrusted contributor note...
    expect(facts.some((f) => f.fact.includes("Roman haunted crypt"))).toBe(true);
    // ...and every context-derived fact is tagged "contributor", none sourced.
    // (The `HeritageFact.source` type no longer even admits "structured".)
    for (const fact of facts) {
      expect(fact.source).toBe("contributor");
      expect(SOURCED_SOURCES.has(fact.source)).toBe(false);
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
});

describe("answerHeritage (no key — grounded only)", () => {
  it("does not present forged client context as a sourced fact or citation", async () => {
    const res = await answerHeritage({
      venueName: "Nowhere Tavern",
      question: "How old is this pub?",
      context: FORGED_CONTEXT,
    });
    // The answer may echo the contributor note, but it must be cited as
    // contributor — never as a structured/sourced fact.
    for (const citation of res.citations) {
      expect(SOURCED_SOURCES.has(citation.source)).toBe(false);
    }
    // The forged context appears only under a "contributor" citation.
    expect(res.citations.some((c) => c.source === "contributor")).toBe(true);
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
});

// FIX 1 guard: retrieval (lib/heritage.ts), the writer (enrich_heritage.mjs),
// and the migration must all agree on the `venue_key` column. If any drifts
// back to `pub_id`/`venue_name`, this fails.
describe("schema key alignment (venue_key)", () => {
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), "utf8");

  it("migration, writer, and retrieval all use venue_key", () => {
    const migration = read("supabase/migrations/0002_pub_heritage.sql");
    const writer = read("scripts/enrich_heritage.mjs");
    const retrieval = read("lib/heritage.ts");

    expect(migration).toMatch(/venue_key\s+text/);
    expect(migration).not.toMatch(/pub_id/);
    expect(writer).toMatch(/venue_key:/);
    expect(writer).not.toMatch(/venue_name:/);
    expect(retrieval).toContain('.eq("venue_key"');
    expect(retrieval).not.toContain("pub_id");
  });
});
