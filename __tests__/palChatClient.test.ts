// Pub Pal chat ask session (lib/palChatClient): latest-ask-wins ordering, honest
// timeout, curated house-voice error copy (no raw JS error text ever reaches the
// UI), and provenance preserved through both response shapes. Hermetic: injected
// fetch, no network, deterministic timers.
import { describe, expect, it, vi } from "vitest";

const authed = vi.hoisted(() => ({
  authedActionFetch: vi.fn<(input: RequestInfo | URL, init: RequestInit, options: unknown) => Promise<Response>>(),
}));

vi.mock("@/lib/authedFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authedFetch")>()),
  authedActionFetch: authed.authedActionFetch,
}));

import { AuthActionSessionError } from "@/lib/authedFetch";
import { PAL_ERROR_FALLBACK } from "@/lib/palChat";
import { createPalChatSession } from "@/lib/palChatClient";
import { defined } from "@/__tests__/helpers/defined";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VENUE_BODY = {
  venues: [
    {
      id: "venue-1",
      name: "The Lamb",
      area: "Bloomsbury",
      cheapestPrice: 5.4,
      reasons: ["A calmer fit"],
    },
  ],
};

const WHATS_ON_BODY = {
  mode: "whats-on",
  message: "Found 1 verified quiz night, each with its source.",
  listings: [
    {
      id: "wo-1",
      kind: "quiz",
      title: "Pub quiz",
      venue: "Sporting Page, Chelsea",
      venueId: "venue-9",
      startsAt: "2026-07-18T18:30:00Z",
      confidence: "confirmed",
      source: { label: "Question One", url: "https://example.com/quiz" },
    },
  ],
};

describe("createPalChatSession", () => {
  it("returns a grounded venue answer with On-record provenance", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () => jsonResponse(VENUE_BODY),
    });
    const result = await ask("quiet near bank", "london");
    expect(result).not.toBeNull();
    expect(result?.status).toBe("answered");
    if (result && result.status === "answered") {
      expect(defined(result.cards[0]).venueId).toBe("venue-1");
      expect(defined(result.cards[0]).provenance).toEqual({
        label: "On record",
        kind: "directory",
      });
    }
  });

  it("returns a What's-On answer that keeps the attributable source link", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () => jsonResponse(WHATS_ON_BODY),
    });
    const result = await ask("quiz tonight in chelsea", "london");
    expect(result?.status).toBe("answered");
    if (result && result.status === "answered") {
      expect(defined(result.cards[0]).provenance).toEqual({
        label: "Question One",
        url: "https://example.com/quiz",
        kind: "whats-on",
      });
    }
  });

  it("drops a stale response when a newer ask supersedes it (latest wins)", async () => {
    let resolveSlow: (r: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => {
      resolveSlow = resolve;
    });
    let call = 0;
    const ask = createPalChatSession({
      fetchImpl: () => {
        call += 1;
        return call === 1 ? slow : Promise.resolve(jsonResponse(VENUE_BODY));
      },
    });

    const first = ask("first", "london");
    const second = await ask("second", "london");
    expect(second?.status).toBe("answered");

    resolveSlow(jsonResponse({ venues: [], message: "stale" }));
    expect(await first).toBeNull();
  });

  it("yields null for a superseded request that ERRORS after being replaced", async () => {
    let rejectSlow: (e: unknown) => void = () => {};
    const slow = new Promise<Response>((_, reject) => {
      rejectSlow = reject;
    });
    let call = 0;
    const ask = createPalChatSession({
      fetchImpl: () => {
        call += 1;
        return call === 1 ? slow : Promise.resolve(jsonResponse(VENUE_BODY));
      },
    });
    const first = ask("first", "london");
    await ask("second", "london");
    rejectSlow(new TypeError("fetch failed"));
    expect(await first).toBeNull();
  });

  it("times out a hung request and ends with curated house-voice copy", async () => {
    const ask = createPalChatSession({
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
  });

  it("surfaces the route's explicit body.error on a non-ok response", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () =>
        jsonResponse({ error: "Too many concierge requests, slow down." }, 429),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({
      status: "error",
      message: "Too many concierge requests, slow down.",
    });
  });

  it("never leaks raw JS error text: a network TypeError gets curated copy", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      },
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
  });

  it("never leaks raw JS error text: a non-JSON body gets curated copy", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () =>
        new Response("<html>502 Bad Gateway</html>", { status: 200 }),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
  });

  it("presents the signed-in session by default", async () => {
    authed.authedActionFetch.mockResolvedValueOnce(jsonResponse(VENUE_BODY));
    const ask = createPalChatSession();
    const result = await ask("quiet near bank", "london");
    expect(result?.status).toBe("answered");
    expect(authed.authedActionFetch).toHaveBeenCalledWith(
      "/api/pub-pal/chat",
      expect.objectContaining({ method: "POST" }),
      { requiresIdentity: true },
    );
  });

  it("says the session is still waking instead of a dead-end error", async () => {
    authed.authedActionFetch.mockRejectedValueOnce(new AuthActionSessionError());
    const ask = createPalChatSession();
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: "Still waking your session. Try again." });
  });

  it("marks a 401 as a sign-in door", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () => jsonResponse({ error: "Sign in to ask Pub Pal." }, 401),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({
      status: "error",
      message: "Sign in to ask Pub Pal.",
      needsSignIn: true,
    });
  });

  it("names the previous answer's conversation as the thread on a follow-up", async () => {
    const bodies: Record<string, unknown>[] = [];
    const ask = createPalChatSession({
      fetchImpl: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ answer: "Two picks.", cards: [], conversationId: "conv_threadtest1" });
      },
    });
    await ask("quiet pubs in Soho", "london");
    await ask("somewhere cheaper there?", "london");
    expect(bodies[0]).not.toHaveProperty("threadId");
    expect(bodies[1]?.threadId).toBe("conv_threadtest1");
  });

  it("curates copy for a non-ok, non-JSON body (no SyntaxError leak)", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () => new Response("upstream blew up", { status: 500 }),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
  });

  describe("streamed answers", () => {
    const FINAL = {
      answer: "Two Soho picks.",
      cards: [
        { key: "c1", venueId: "v1", title: "The Crown", place: "Soho", note: "Listed pint.", price: 4.8 },
      ],
      proposals: [],
      conversationId: "conv_streamtest1",
    };

    function ndjson(events: unknown[], chunkAt = 0): Response {
      const text = events.map((event) => `${JSON.stringify(event)}\n`).join("");
      const encoder = new TextEncoder();
      const bytes = encoder.encode(text);
      const cut = chunkAt || bytes.length;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, cut));
            controller.enqueue(bytes.slice(cut));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8" } },
      );
    }

    it("asks for a stream only when the caller will show progress", async () => {
      const accepts: Array<string | undefined> = [];
      const ask = createPalChatSession({
        fetchImpl: async (_input, init) => {
          accepts.push((init?.headers as Record<string, string> | undefined)?.accept);
          return jsonResponse(FINAL);
        },
      });
      await ask("quiet pubs", "london");
      await ask("quiet pubs", "london", () => {});
      expect(accepts).toEqual([undefined, "application/x-ndjson"]);
    });

    it("reports the text so far as it arrives, clears it on a reset, and returns the final answer", async () => {
      const shown: string[] = [];
      const ask = createPalChatSession({
        fetchImpl: async () =>
          ndjson([
            { type: "delta", text: "Let me check." },
            { type: "reset" },
            { type: "delta", text: "Two Soho" },
            { type: "delta", text: " picks." },
            { type: "final", body: FINAL },
          ]),
      });

      const result = await ask("pint in Soho", "london", (text) => shown.push(text));

      expect(shown).toEqual(["Let me check.", "", "Two Soho", "Two Soho picks."]);
      expect(result).toMatchObject({
        status: "answered",
        message: "Two Soho picks.",
        cards: [expect.objectContaining({ title: "The Crown" })],
      });
    });

    it("reads a line that is split across two chunks", async () => {
      const shown: string[] = [];
      const ask = createPalChatSession({
        fetchImpl: async () =>
          ndjson([{ type: "delta", text: "Two Soho picks." }, { type: "final", body: FINAL }], 17),
      });
      const result = await ask("pint in Soho", "london", (text) => shown.push(text));
      expect(shown).toEqual(["Two Soho picks."]);
      expect(result?.status).toBe("answered");
    });

    it("carries the thread on a follow-up after a streamed answer", async () => {
      const bodies: Record<string, unknown>[] = [];
      const ask = createPalChatSession({
        fetchImpl: async (_input, init) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return ndjson([{ type: "final", body: FINAL }]);
        },
      });
      await ask("quiet pubs in Soho", "london", () => {});
      await ask("somewhere cheaper there?", "london", () => {});
      expect(bodies[1]?.threadId).toBe("conv_streamtest1");
    });

    it("answers an error event with its curated copy and keeps the turn out of the thread", async () => {
      const ask = createPalChatSession({
        fetchImpl: async () =>
          ndjson([{ type: "delta", text: "Two" }, { type: "error", error: PAL_ERROR_FALLBACK }]),
      });
      const result = await ask("pint in Soho", "london", () => {});
      expect(result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
    });

    it("treats a stream that ends with no final event as a failure, not an empty answer", async () => {
      const ask = createPalChatSession({
        fetchImpl: async () => ndjson([{ type: "delta", text: "Two Soho" }]),
      });
      const result = await ask("pint in Soho", "london", () => {});
      expect(result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
    });

    it("still reads one JSON body when the server does not stream", async () => {
      const shown: string[] = [];
      const ask = createPalChatSession({ fetchImpl: async () => jsonResponse(FINAL) });
      const result = await ask("pint in Soho", "london", (text) => shown.push(text));
      expect(shown).toEqual([]);
      expect(result).toMatchObject({ status: "answered", message: "Two Soho picks." });
    });

    it("refuses with sign-in copy on a 401 even when a stream was asked for", async () => {
      const ask = createPalChatSession({
        fetchImpl: async () => jsonResponse({ error: "Sign in to ask Pub Pal." }, 401),
      });
      const result = await ask("anything", "london", () => {});
      expect(result).toEqual({ status: "error", message: "Sign in to ask Pub Pal.", needsSignIn: true });
    });

    it("drops the progress of an ask that a newer ask has replaced", async () => {
      const shownByFirst: string[] = [];
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ask = createPalChatSession({
        fetchImpl: async (_input, init) => {
          const first = JSON.parse(String(init?.body)).query === "first";
          if (first) await gate;
          return ndjson([{ type: "delta", text: first ? "stale" : "fresh" }, { type: "final", body: FINAL }]);
        },
      });
      const first = ask("first", "london", (text) => shownByFirst.push(text));
      const second = ask("second", "london", () => {});
      release();

      expect(await first).toBeNull();
      expect((await second)?.status).toBe("answered");
      expect(shownByFirst).toEqual([]);
    });
  });
});
