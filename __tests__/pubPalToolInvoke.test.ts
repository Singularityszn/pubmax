import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { offlineFetch } from "@/evals/pal/offlineFetch";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import { haversineKm } from "@/lib/haversine";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import {
  enrichPubPalToolArgs,
  invokePubPalAskTool,
  resolvePubPalToolQuery,
} from "@/lib/pubPalToolInvoke.server";
import {
  __resetPubPalToolTurnStore,
  readPubPalToolTurn,
  registerPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const fence = vi.hoisted(() => ({ forceFenced: false }));
const store = vi.hoisted(() => ({ failAppend: false }));

vi.mock("@/lib/pubPalToolTurnStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pubPalToolTurnStore")>();
  return {
    ...actual,
    appendPubPalToolTurn: async (
      ...args: Parameters<typeof actual.appendPubPalToolTurn>
    ) => {
      if (store.failAppend) throw new Error("pub_pal_tool_turns unavailable");
      return actual.appendPubPalToolTurn(...args);
    },
  };
});

vi.mock("@/lib/pubPalLlmFence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pubPalLlmFence")>();
  return {
    ...actual,
    resolvePubPalFenceIntent: async (
      ...args: Parameters<typeof actual.resolvePubPalFenceIntent>
    ) =>
      fence.forceFenced
        ? { fenced: true, sobrietyOnly: false }
        : actual.resolvePubPalFenceIntent(...args),
  };
});

describe("pubPal webhook arg resolution", () => {
  it("prefers the stored turn query over a short ElevenLabs fragment", () => {
    const query = resolvePubPalToolQuery({
      turnQuery: "What is the cheapest pint near Soho?",
      args: { query: "Soho" },
    });
    expect(query).toBe("What is the cheapest pint near Soho?");
  });

  it("enriches cheapest_pint_near from the full ask when only query is sent", () => {
    const args = enrichPubPalToolArgs(
      "cheapest_pint_near",
      { query: "Soho" },
      "What is the cheapest pint near Soho?",
    );
    expect(args.area === "Soho" || args.venueName === "Soho").toBe(true);
  });

  it("enriches propose_plan with the routed crawl ask", () => {
    const args = enrichPubPalToolArgs(
      "propose_plan",
      {},
      "Plan me a 3 pub crawl in Shoreditch tonight",
    );
    expect(args.query).toBe("Plan me a 3 pub crawl in Shoreditch tonight");
  });
});

describe("propose_plan over the Pal webhook", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", offlineFetch);
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    fence.forceFenced = false;
    store.failAppend = false;
    vi.restoreAllMocks();
    __resetPubPalToolTurnStore();
    vi.unstubAllGlobals();
  });

  async function planFor(query: string) {
    const { result } = await invokePubPalAskTool({
      toolName: "propose_plan",
      args: { query },
      conversationId: null,
    });
    return result as {
      ok: boolean;
      cards: Array<{ venueId: string }>;
      proposals: Array<{ kind: string; stopIds?: string[] }>;
    };
  }

  // The live agent sent these asks and answered that it could not plan a
  // Shoreditch crawl: "tonight" was read as part of the area, and a bare
  // "Shoreditch crawl" planned three pubs across London.
  it.each([
    "Plan me a 3 pub crawl in Shoreditch tonight",
    "Can you plan a Shoreditch crawl?",
  ])("drafts three Shoreditch stops for %j", async (query) => {
    const result = await planFor(query);

    expect(result.ok).toBe(true);
    const draft = result.proposals.find((proposal) => proposal.kind === "draft_plan");
    expect(draft?.stopIds).toHaveLength(3);

    const shoreditch = NIGHT_AREAS.find((area) => area.slug === "shoreditch")!;
    const venues = new Map((await loadConciergeVenues("london")).map((venue) => [venue.id, venue]));
    for (const card of result.cards) {
      const venue = venues.get(card.venueId)!;
      expect(
        haversineKm([shoreditch.centre.lng, shoreditch.centre.lat], [venue.lng, venue.lat]),
      ).toBeLessThan(3);
    }
  });

  it("records a fenced propose_plan in the turn the chat reads", async () => {
    const conversationId = "conv_fencedplan01";
    await registerPubPalToolTurn(conversationId, {
      query: "Plan me a 3 pub crawl in Shoreditch tonight",
      cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    fence.forceFenced = true;

    const { result } = await invokePubPalAskTool({
      toolName: "propose_plan",
      args: { query: "Plan me a 3 pub crawl in Shoreditch tonight" },
      conversationId,
    });

    expect(result).toMatchObject({ ok: true, fenced: true });
    const turn = await readPubPalToolTurn(conversationId);
    expect(turn?.toolsUsed).toEqual(["propose_plan"]);
    expect(turn?.hints).toEqual([result.answerHint]);
  });

  it("still returns the get-home register when the store write fails", async () => {
    const conversationId = "conv_fencedplan02";
    await registerPubPalToolTurn(conversationId, {
      query: "Plan me a 3 pub crawl in Shoreditch tonight",
      cityId: "london",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    fence.forceFenced = true;
    store.failAppend = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = await invokePubPalAskTool({
      toolName: "propose_plan",
      args: { query: "Plan me a 3 pub crawl in Shoreditch tonight" },
      conversationId,
    });

    expect(result).toMatchObject({ ok: true, fenced: true });
    expect(typeof result.answerHint).toBe("string");
    expect(warn).toHaveBeenCalledWith(
      "pub-pal-tool.fenced-append-failed",
      expect.objectContaining({ toolName: "propose_plan" }),
    );
  });
});
