// Ephemeral correlation for ElevenLabs tool webhooks during one Pal chat turn.
// Keys are conversation ids from the provider; entries expire quickly and hold
// no user text in logs.

import type { AskCard, AskProposal } from "@/lib/ask/types";
import type { CityId } from "@/lib/cities";
import type { PubPalFenceTurn } from "@/lib/pubPalLlmFence";

const TTL_MS = 120_000;

export type PubPalToolTurn = {
  query: string;
  cityId: CityId;
  turns: PubPalFenceTurn[];
  expiresAt: number;
  cards: AskCard[];
  proposals: AskProposal[];
  hints: string[];
};

const turns = new Map<string, PubPalToolTurn>();

function prune(now: number): void {
  for (const [key, turn] of turns) {
    if (turn.expiresAt <= now) turns.delete(key);
  }
}

export function registerPubPalToolTurn(
  conversationId: string,
  input: { query: string; cityId: CityId; turns?: PubPalFenceTurn[] },
): void {
  const now = Date.now();
  prune(now);
  turns.set(conversationId, {
    query: input.query,
    cityId: input.cityId,
    turns: Array.isArray(input.turns) ? input.turns.slice(-6) : [],
    expiresAt: now + TTL_MS,
    cards: [],
    proposals: [],
    hints: [],
  });
}

export function readPubPalToolTurn(conversationId: string): PubPalToolTurn | null {
  const turn = turns.get(conversationId);
  if (!turn) return null;
  if (turn.expiresAt <= Date.now()) {
    turns.delete(conversationId);
    return null;
  }
  return turn;
}

export function appendPubPalToolTurn(
  conversationId: string,
  patch: {
    cards?: AskCard[];
    proposals?: AskProposal[];
    hints?: string[];
  },
): void {
  const turn = readPubPalToolTurn(conversationId);
  if (!turn) return;
  if (patch.cards?.length) turn.cards.push(...patch.cards);
  if (patch.proposals?.length) turn.proposals.push(...patch.proposals);
  if (patch.hints?.length) turn.hints.push(...patch.hints);
}

export function consumePubPalToolTurn(conversationId: string): PubPalToolTurn | null {
  const turn = readPubPalToolTurn(conversationId);
  if (!turn) return null;
  turns.delete(conversationId);
  return turn;
}
