import { beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/heritage/route";
import { answerHeritage, retrieveHeritage } from "@/lib/heritage";

// These tests run fully offline: no OPENROUTER key, no Supabase, no network.
// They pin the grounding guarantee — the no-key path only ever repeats the
// facts we handed in, and says so honestly when there are none.
beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const CONTEXT = {
  era: "Tudor 1520",
  heritageNote: "Riverside Wapping pub used by smugglers and river workers.",
};

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/heritage", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("retrieveHeritage", () => {
  it("returns >=2 structured facts from era + heritageNote context", async () => {
    const facts = await retrieveHeritage({
      venueName: "Prospect of Whitby",
      context: CONTEXT,
    });
    const structured = facts.filter((f) => f.source === "structured");
    expect(structured.length).toBeGreaterThanOrEqual(2);
    expect(facts.some((f) => f.fact.includes("Tudor 1520"))).toBe(true);
  });
});

describe("answerHeritage (no key — grounded only)", () => {
  it("answers only from the provided facts and cites them", async () => {
    const res = await answerHeritage({
      venueName: "Prospect of Whitby",
      question: "How old is this pub?",
      context: CONTEXT,
    });
    // Contains what we provided...
    expect(res.answer).toContain("Tudor 1520");
    // ...and nothing we did not provide.
    expect(res.answer).not.toContain("Roman");
    expect(res.answer).not.toContain("haunted");
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.citations.some((c) => c.source === "structured")).toBe(true);
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

  it("returns a grounded 200 for a valid request", async () => {
    const res = await post({
      venueName: "Prospect of Whitby",
      question: "How old is this pub?",
      context: CONTEXT,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toContain("Tudor 1520");
  });
});
