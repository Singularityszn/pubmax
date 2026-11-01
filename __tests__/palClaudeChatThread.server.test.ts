import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Typed Pub Pal chat on Claude against the real tool-turn store: a follow-up
// starts clean, and two asks from one person never share a row.

vi.mock("@/lib/pubPalLlmFence", () => ({
  resolvePubPalFenceIntent: vi.fn(async () => ({ fenced: false, sobrietyOnly: false })),
  pubPalGetHomeRegisterAnswer: vi.fn(() => "Getting Home has the trains."),
}));

vi.mock("@/lib/palTaste.server", () => ({ readPalTaste: vi.fn(async () => null) }));

import { runPalClaudeChatTurn, type PalClaudeClient } from "@/lib/palClaudeChat.server";
import { __resetPubPalStore } from "@/lib/pubPalStore";
import {
  __resetPubPalToolTurnStore,
  appendPubPalToolTurn,
  readPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const SOHO_CARD = { key: "v1", venueId: "london-a", title: "The Crown", place: "Soho", note: "Listed pint.", price: 4.8 };

function reply(content: Anthropic.ContentBlock[], stopReason: Anthropic.StopReason): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as unknown as Anthropic.Message;
}

const say = (text: string) => reply([{ type: "text", text, citations: null } as Anthropic.TextBlock], "end_turn");
const callTool = (id: string, query: string) =>
  reply([{ type: "tool_use", id, name: "search_venues", input: { query } } as Anthropic.ToolUseBlock], "tool_use");

/** A client whose rounds come from a function of the request, so overlapping turns can script themselves. */
function scriptedClient(next: (body: Anthropic.MessageStreamParams) => Promise<Anthropic.Message>): PalClaudeClient {
  return {
    stream(body) {
      const message = next(structuredClone(body));
      return {
        on() {
          return this;
        },
        finalMessage: () => message,
      };
    },
  };
}

describe("typed Pub Pal chat on Claude, with the real turn store", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    __resetPubPalToolTurnStore();
  });

  afterEach(() => {
    __resetPubPalToolTurnStore();
    __resetPubPalStore();
    vi.unstubAllEnvs();
  });

  it("answers a follow-up without the earlier ask's cards", async () => {
    let round = 0;
    const client = scriptedClient(async () => {
      round += 1;
      if (round === 1) return callTool("tu_1", "pubs in Soho");
      if (round === 2) return say("The Crown in Soho.");
      return say("Camden is quieter tonight, I have nothing listed there.");
    });
    const runTool = async (_name: string, _args: Record<string, unknown>, conversationId: string) => {
      await appendPubPalToolTurn(conversationId, { cards: [SOHO_CARD], toolsUsed: ["search_venues"] });
      return { ok: true, answerHint: "1 sourced result(s)." };
    };

    const first = await runPalClaudeChatTurn({ query: "pubs in Soho", ownerId: OWNER }, undefined, { client, runTool });
    expect(first).toMatchObject({ ok: true, cards: [SOHO_CARD] });
    if (!first.ok) return;

    const followUp = await runPalClaudeChatTurn(
      { query: "what about Camden", threadId: first.conversationId, ownerId: OWNER },
      undefined,
      { client, runTool },
    );

    expect(followUp).toMatchObject({ ok: true, cards: [], proposals: [], toolsUsed: [] });
    if (!followUp.ok) return;
    expect(followUp.conversationId).not.toBe(first.conversationId);
    // The follow-up still reads the earlier ask, from its own new row.
    expect((await readPubPalToolTurn(followUp.conversationId))?.turns).toEqual([{ role: "user", content: "pubs in Soho" }]);
  });

  it("keeps two overlapping follow-ups in one thread in their own rows", async () => {
    let releaseFirstTool!: () => void;
    const firstToolMayRun = new Promise<void>((resolve) => {
      releaseFirstTool = resolve;
    });
    const client = scriptedClient(async (body) => {
      const ask = String(body.messages[0]!.content).split("\n").at(-1) ?? "";
      if (body.messages.length === 1) return callTool(ask.includes("Soho") ? "tu_soho" : "tu_camden", ask);
      return say(ask.includes("Soho") ? "Soho answer." : "Camden answer.");
    });
    const seen: Array<{ conversationId: string; storedQuery: string | undefined }> = [];
    const runTool = async (_name: string, args: Record<string, unknown>, conversationId: string) => {
      // The Soho tool waits until the Camden ask has registered and finished.
      if (String(args.query).includes("Soho")) await firstToolMayRun;
      seen.push({ conversationId, storedQuery: (await readPubPalToolTurn(conversationId))?.query });
      const card = String(args.query).includes("Soho") ? SOHO_CARD : { ...SOHO_CARD, key: "v2", title: "The Lock", place: "Camden" };
      await appendPubPalToolTurn(conversationId, { cards: [card], toolsUsed: ["search_venues"] });
      return { ok: true };
    };

    // Both follow the same earlier answer, so both name its thread.
    const opening = await runPalClaudeChatTurn({ query: "a night out", ownerId: OWNER }, undefined, {
      client: scriptedClient(async () => say("Where are you heading?")),
    });
    expect(opening.ok).toBe(true);
    if (!opening.ok) return;
    const threadId = opening.conversationId;

    const soho = runPalClaudeChatTurn({ query: "pubs in Soho", threadId, ownerId: OWNER }, undefined, { client, runTool });
    const camden = await runPalClaudeChatTurn({ query: "pubs in Camden", threadId, ownerId: OWNER }, undefined, { client, runTool });
    releaseFirstTool();
    const sohoOutcome = await soho;

    expect(camden).toMatchObject({ ok: true, message: "Camden answer." });
    expect(sohoOutcome).toMatchObject({ ok: true, message: "Soho answer.", cards: [SOHO_CARD] });
    if (!camden.ok || !sohoOutcome.ok) return;
    expect(new Set([threadId, camden.conversationId, sohoOutcome.conversationId]).size).toBe(3);
    expect(camden.cards.map((card) => card.title)).toEqual(["The Lock"]);
    // Each tool read its own ask, never the other one's.
    expect(seen).toEqual([
      { conversationId: camden.conversationId, storedQuery: "pubs in Camden" },
      { conversationId: sohoOutcome.conversationId, storedQuery: "pubs in Soho" },
    ]);
  });
});
