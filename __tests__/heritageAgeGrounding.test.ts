import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {}, assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => false,
  getSupabaseAdmin: () => null,
}));

import { POST } from "@/app/api/heritage/route";
import * as historic from "@/lib/historic";

// The ad3af9599 browser failure for venue-xiesdn on 8 September 2026: a model
// turned "the current building dates from 1897" into "approximately 127 years
// old". The Landlord now calls no model, so the answer can only read back the
// cited facts on record.
const BUILDING_FACT = "The Dog and Duck at 18 Bateman Street, Soho, is a Grade II listed pub; the current building dates from 1897 and its upstairs dining room is named after the writer George Orwell, who was a regular.";
const WIKIPEDIA = "https://en.wikipedia.org/wiki/Dog_and_Duck,_Soho";
const network = vi.fn<typeof fetch>(async () => {
  throw new Error("The Landlord must not reach the network.");
});

async function ask() {
  const response = await POST(new Request("http://localhost/api/heritage", {
    method: "POST",
    body: JSON.stringify({ venueId: "venue-xiesdn", venueName: "The Dog & Duck", question: "How old is it?" }),
  }));
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  // Model keys on the deployment change nothing: no provider is asked.
  vi.stubEnv("ANTHROPIC_API_KEY", "offline-test-key");
  vi.stubEnv("OPENROUTER_API_KEY", "offline-test-key");
  network.mockClear();
  vi.stubGlobal("fetch", network);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("answers an age question with the cited building date through the real route and calls no model", async () => {
  const result = await ask();
  expect(network).not.toHaveBeenCalled();
  expect(result.answer).toContain("Here's what's on record");
  expect(result.answer).toContain(BUILDING_FACT.slice(0, -1));
  expect(result.answer).not.toMatch(/years old|127/);
  expect(result.citations).toContainEqual({ source: "wikipedia", ref: WIKIPEDIA });
  expect(result.citations).toContainEqual({ source: "nhle", ref: "https://historicengland.org.uk/listing/the-list/list-entry/1264051" });
});

it.each([
  "The current building was built in 1897.",
  "At the time of the survey, the building was 127 years old.",
])("repeats a supplied building statement word for word: %s", async (fact) => {
  const [record] = await historic.loadHistoricPubs();
  if (!record) throw new Error("The heritage fixture is missing.");
  const read = vi.spyOn(historic, "loadHistoricPubs").mockResolvedValueOnce([{
    ...record,
    venueId: "venue-xiesdn",
    facts: [{ source: "wikipedia", fact, sourceRef: WIKIPEDIA }],
  }]);
  try {
    const result = await ask();
    expect(result.answer).toContain(fact.slice(0, -1));
    expect(result.citations).toContainEqual({ source: "wikipedia", ref: WIKIPEDIA });
    expect(network).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
  }
});
