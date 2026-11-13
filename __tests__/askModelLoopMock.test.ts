import { join } from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { LLMock, type JournalEntry } from "@copilotkit/aimock";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAsk, type RunAskInput } from "@/lib/ask/runAsk";
import type { ClaudeClient } from "@/lib/claudeClient.server";
import { offlineFetch, requestUrl } from "@/evals/pal/offlineFetch";
import { loadPalEvalSuite } from "@/evals/pal/loadSuite";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import { PINT_DATASET_TEST_NOW } from "@/__tests__/helpers/pintDatasetClock";

/**
 * THE LIVE ASK LOOP, DRIVEN OVER HTTP BY A MODEL THAT ANSWERS FROM FIXTURES.
 *
 * `npm run eval:pal` skips the model and `eval:pal:live` needs a paid key, so
 * nothing in CI exercised the tool-calling path in `lib/ask/modelLoop.ts`. Here
 * aimock serves the Claude Messages wire from
 * `__tests__/fixtures/aimock/ask-model-loop.json`, an Anthropic SDK client
 * pointed at it is handed to `runAsk`, and every case runs with the real tool
 * handlers. Every other host stays on the Pal eval's offline stub, and the Pal
 * eval's pinned `now` keeps event tools on an evening the fixtures cover.
 * The pint-card case uses a later instant, after the published price observations.
 */

/** aimock journals every provider's request in one chat-completions shape. */
type SentMessage = { role: string; content: string | null; tool_call_id?: string };

const mock = new LLMock({ port: 0, logLevel: "silent" });
const { now } = loadPalEvalSuite(process.cwd());
const venueIndex = loadPalEvalVenueIndex(process.cwd());

/** Signals of the model calls the loop made, journaled or not: aimock journals no aborted request. */
const modelSignals: Array<AbortSignal | null | undefined> = [];

const mockFetch: typeof fetch = (input, init) => {
  if (!requestUrl(input).startsWith(mock.url)) return offlineFetch(input, init);
  modelSignals.push(init?.signal);
  return fetch(input, init);
};

/** The Claude client the loop sends on, pointed at aimock instead of api.anthropic.com. */
function mockClaude(): ClaudeClient {
  const sdk = new Anthropic({ apiKey: "aimock", baseURL: mock.url, maxRetries: 0, fetch: mockFetch });
  return { stream: (body, options) => sdk.messages.stream(body, options) };
}

function ask(query: string, extra: Partial<RunAskInput> = {}) {
  return runAsk({ query, cityId: "london", now, fetchImpl: offlineFetch, claude: mockClaude(), ...extra });
}

function modelRequests(): JournalEntry[] {
  return mock.getRequests().filter((entry) => entry.path.endsWith("/v1/messages"));
}

function sentMessages(entry: JournalEntry): SentMessage[] {
  return (entry.body as { messages: SentMessage[] }).messages;
}

function toolReplies(entry: JournalEntry): SentMessage[] {
  return sentMessages(entry).filter((message) => message.role === "tool");
}

beforeAll(async () => {
  mock.loadFixtureFile(join(process.cwd(), "__tests__/fixtures/aimock/ask-model-loop.json"));
  await mock.start();
});

afterAll(async () => {
  await mock.stop();
});

beforeEach(() => {
  mock.clearRequests();
  modelSignals.length = 0;
  // The key only switches the model on; the client above is what sends.
  vi.stubEnv("ANTHROPIC_API_KEY", "aimock");
  vi.stubEnv("TYPESAFE_API_KEY", undefined);
  return () => vi.unstubAllEnvs();
});

describe("runAsk against a mock Claude", () => {
  it("runs a single allowlisted tool call and keeps its grounded cards", async () => {
    // A clock after the committed Camden price reads, which are never in its future.
    const body = await ask("Cheapest pint in Camden tonight", { now: PINT_DATASET_TEST_NOW });

    const requests = modelRequests();
    expect(requests.map((entry) => entry.response.status)).toEqual([200, 200]);
    expect(requests[0]!.path).toBe("/v1/messages");
    // aimock redacts the key in its journal; that it was sent is the check.
    expect(requests[0]!.headers.authorization).toBeTruthy();
    expect(toolReplies(requests[1]!)).toHaveLength(1);
    expect(body.toolsUsed).toEqual(["cheapest_pint_near"]);
    expect(body.cards.length).toBeGreaterThan(0);
    for (const card of body.cards) {
      if (card.venueId) expect(venueIndex.ids.has(card.venueId)).toBe(true);
    }
  });

  it("follows the model through two rounds of tools", async () => {
    const body = await ask("What do they pour at The Lamb");

    const requests = modelRequests();
    expect(requests.map((entry) => entry.response.status)).toEqual([200, 200, 200]);
    expect(toolReplies(requests[2]!).map((message) => message.tool_call_id)).toEqual([
      "pal-two-1",
      "pal-two-2",
    ]);
    expect(body.toolsUsed).toEqual(["cheapest_pint_near", "venue_drinks"]);
  });

  it("refuses a tool off the allowlist and falls back to the deterministic path", async () => {
    const query = "Plan a crawl in Soho for 4";
    const body = await ask(query);

    const requests = modelRequests();
    expect(requests.map((entry) => entry.response.status)).toEqual([200, 200]);
    const [reply] = toolReplies(requests[1]!);
    expect(reply?.tool_call_id).toBe("pal-offlist-1");
    expect(JSON.parse(reply!.content!)).toEqual({ error: "Tool not allowlisted." });
    expect(body.toolsUsed).not.toContain("book_table");
    expect(body).toEqual(await ask(query, { skipModel: true }));
  });

  it("answers from the deterministic path when the model misses the deadline", async () => {
    const query = "Any tube delays right now?";
    const started = performance.now();
    const body = await ask(query, { modelTimeoutMs: 250 });

    expect(performance.now() - started).toBeLessThan(1_500);
    expect(modelSignals).toHaveLength(1);
    expect(modelSignals[0]?.aborted).toBe(true);
    expect(modelRequests()).toHaveLength(0);
    expect(body).toEqual(await ask(query, { skipModel: true }));
  });

  it("stops after three rounds and runs at most three calls a round", async () => {
    const body = await ask("Cheapest pint in Islington");

    const requests = modelRequests();
    expect(requests).toHaveLength(3);
    // Claude needs a result for every call, so the fourth gets an error and runs nothing.
    const round = ["pal-runaway-1", "pal-runaway-2", "pal-runaway-3", "pal-runaway-4"];
    const replies = toolReplies(requests[2]!);
    expect(replies.map((message) => message.tool_call_id)).toEqual([...round, ...round]);
    for (const reply of replies.filter((message) => message.tool_call_id === "pal-runaway-4")) {
      expect(JSON.parse(reply.content!)).toEqual({ error: "Only 3 tools run per round." });
    }
    expect(body.toolsUsed).toEqual(["cheapest_pint_near"]);
  });
});
