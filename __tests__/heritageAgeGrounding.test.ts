import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {}, assertServerEnv: () => {} }));
vi.mock("@/lib/paidSpendBudget.server", () => ({ paidSpendBudgetRefusal: async () => null }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => false,
  getSupabaseAdmin: () => null,
}));

import { POST } from "@/app/api/heritage/route";
import { __resetHeritageCache } from "@/lib/heritage";

// Retained from the ad3af9599 browser failure for venue-xiesdn on 8 September 2026.
const RETAINED_ANSWER = "Based on the context provided, the current building of the Dog and Duck dates from **1897** [F2, Wikipedia], which makes it approximately **127 years old**.\n\nHowever, this refers specifically to when the current building was constructed. The pub itself may have a longer history at this location, but the context doesn't provide information about any earlier buildings or when the pub was first established.";
const WIKIPEDIA = "https://en.wikipedia.org/wiki/Dog_and_Duck,_Soho";
const modelFetch = vi.fn<typeof fetch>();

function modelReply(answer: string): Response {
  return Response.json({ choices: [{ message: { content: answer } }] });
}

async function ask() {
  const response = await POST(new Request("http://localhost/api/heritage", {
    method: "POST",
    body: JSON.stringify({ venueId: "venue-xiesdn", venueName: "The Dog & Duck", question: "How old is it?" }),
  }));
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(() => {
  __resetHeritageCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  vi.stubEnv("OPENROUTER_API_KEY", "offline-test-key");
  modelFetch.mockReset();
  modelFetch.mockImplementation(async (url) => {
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    return modelReply(RETAINED_ANSWER);
  });
  // Every HTTP request stays in this stub, including any unexpected request.
  vi.stubGlobal("fetch", modelFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("rejects the retained 127-year claim and returns the cited building date through the real route", async () => {
  const result = await ask();
  expect(modelFetch).toHaveBeenCalledTimes(1);
  expect(result.answer).not.toContain("127");
  expect(result.answer).toContain("Here's what's on record");
  expect(result.answer).toContain("the current building dates from 1897");
  expect(result.citations).toContainEqual({ source: "wikipedia", ref: WIKIPEDIA });
  expect(result.citations).toContainEqual({ source: "nhle", ref: "https://historicengland.org.uk/listing/the-list/list-entry/1264051" });
});

it.each([2026, 2027])("does not substitute a calculated age for a year-only building date in %s", async (year) => {
  vi.setSystemTime(new Date(`${year}-09-08T12:00:00Z`));
  modelFetch.mockResolvedValue(modelReply(`The building is ${year - 1897} years old [F2].`));
  const result = await ask();
  expect(result.answer).toContain("the current building dates from 1897");
  expect(result.answer).not.toContain("years old");
});

it("rejects an invented date even when the model cites a valid fact", async () => {
  modelFetch.mockResolvedValue(modelReply("The pub was founded in 1907 [F2]."));
  expect((await ask()).answer).not.toContain("1907");
});

it("keeps a supplied date and its attribution after rejecting an unsupported age", async () => {
  await ask();
  modelFetch.mockResolvedValue(modelReply("Wikipedia dates the current building to 1897 [F2]."));
  const result = await ask();
  expect(modelFetch).toHaveBeenCalledTimes(2);
  expect(result.answer).toBe("Wikipedia dates the current building to 1897.");
  expect(result.citations).toContainEqual({ source: "wikipedia", ref: WIKIPEDIA });
});

it("instructs the model to retain dates and distinguish construction from founding", async () => {
  await ask();
  const request = modelFetch.mock.calls[0][1]!;
  const prompt = JSON.parse(request.body as string).messages[0].content;
  expect(prompt).toContain("Do not calculate present-day ages");
  expect(prompt).toContain("construction or rebuilding date is not a founding date");
});

it("keeps the keyless answer grounded in the same supplied building date", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  const result = await ask();
  expect(modelFetch).not.toHaveBeenCalled();
  expect(result.answer).toContain("the current building dates from 1897");
  expect(result.citations).toContainEqual({ source: "wikipedia", ref: WIKIPEDIA });
});
