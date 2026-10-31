"use client";

import type { AskMenuEvidence, AskProposal, AskTurn } from "@/lib/ask/types";
import type { RememberedArea } from "@/lib/nightPatches";
import type { PalAnswer } from "@/lib/palChat";
import { palChatResultFromBody } from "@/lib/palChatClient";
import { resolvePalLocality, type PalLocality } from "@/lib/palLocality";
import { recentPalSessionTurns } from "@/lib/palSessionTurns";
import type { PalRecall } from "@/lib/palRecall";
import { isPubPalConversationId, PUB_PAL_CONVERSATION_IDLE_MS } from "@/lib/pubPalConversationId";
import { readSurfaceSnapshot, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";

export type PalChatEntry =
  | { kind: "user"; id: string; text: string }
  | { kind: "answer"; id: string; answer: PalAnswer; locality: PalLocality | null; proposals: AskProposal[]; recall: PalRecall | null }
  | { kind: "error"; id: string; message: string; needsSignIn?: boolean; retryQuery?: string };

/** Search results own the map until another search replaces them, including an empty result. */
export function palChatMapAnswer(entries: readonly PalChatEntry[]): Extract<PalChatEntry, { kind: "answer" }> | undefined {
  return entries.findLast((entry): entry is Extract<PalChatEntry, { kind: "answer" }> => entry.kind === "answer"
    && Boolean(entry.answer.toolsUsed?.some((tool) => tool === "search_venues" || tool === "cheapest_pint_near")));
}

export type PalChatThread = {
  entries: PalChatEntry[];
  priorAsks: string[];
  turns: AskTurn[];
  conversationId: string;
  conversationAt: number;
};

const key = (owner: string) => `/pal/chat#current-thread-v2/${encodeURIComponent(owner)}`;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";

function safeUrl(value: unknown): string | undefined {
  try {
    const parsed = new URL(text(value, 2048));
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch { return undefined; }
}

function menuEvidence(value: unknown): AskMenuEvidence | undefined {
  const item = record(value);
  if (!item || item.kind !== "published-menu" || item.currency !== "GBP" || item.availability !== "unknown"
    || (item.menu !== "food" && item.menu !== "drink")) return undefined;
  if (!["itemId", "itemName", "category", "source", "licence"].every((field) => typeof item[field] === "string")) return undefined;
  if (![item.serving, item.observedAt].every((field) => field === null || typeof field === "string")) return undefined;
  if (item.sourceUrl !== null && !safeUrl(item.sourceUrl)) return undefined;
  if (item.caloriesKcal !== null && (typeof item.caloriesKcal !== "number" || !Number.isFinite(item.caloriesKcal) || item.caloriesKcal < 0)) return undefined;
  if (!Array.isArray(item.dietary) || !item.dietary.every((field) => ["vegan", "vegetarian", "gluten-free"].includes(field))) return undefined;
  for (const field of [item.caloriesProvenance, item.dietaryProvenance]) {
    if (field === null) continue;
    const provenance = record(field);
    if (!provenance || !["source", "licence", "observedAt"].every((name) => typeof provenance[name] === "string") || !safeUrl(provenance.sourceUrl)) return undefined;
  }
  return item as AskMenuEvidence;
}

/** Use the existing tab cache, including its account-change purge and age limit. */
export async function savePalChatThread(owner: string, entries: PalChatEntry[], conversationId: string, conversationAt: number, turns: readonly AskTurn[], signal?: AbortSignal): Promise<void> {
  const recent = await recentPalSessionTurns(turns);
  if (signal?.aborted) return;
  writeSurfaceSnapshot(key(owner), { version: 2, entries: entries.slice(-24), conversationId, conversationAt, turns: recent });
}

export function clearPalChatThread(owner: string): void {
  writeSurfaceSnapshot(key(owner), null);
}

function restoreAnswer(entry: Record<string, unknown>, id: string, query: string | undefined): PalChatEntry | null {
  const answer = record(entry.answer);
  if (typeof answer?.message !== "string" || !Array.isArray(answer.cards)) return null;
  if (answer.cards.some((value) => {
    const card = record(value);
    return !card || typeof card.title !== "string" || !card.title.trim()
      || (card.price !== null && (typeof card.price !== "number" || !Number.isFinite(card.price)));
  })) return null;
  // A tab snapshot can be damaged. Keep only the card's primitive facts
  // and safe source links through the same normalizer as a new response.
  const cards = answer.cards.slice(0, 6).map((rawCard) => {
    const card = record(rawCard);
    const provenance = record(card?.provenance);
    const url = safeUrl(provenance?.url);
    const evidence = menuEvidence(card?.menuEvidence);
    return {
      key: text(card?.key, 120), venueId: text(card?.venueId, 120), title: text(card?.title, 300),
      place: text(card?.place, 300), note: text(card?.note, 3000), price: card?.price,
      provenance: { label: text(provenance?.label, 500), kind: provenance?.kind, ...(url ? { url } : {}) },
      ...(evidence ? { menuEvidence: evidence } : {}),
      ...(typeof card?.when === "string" ? { when: card.when } : {}),
      ...(typeof card?.confidence === "string" ? { confidence: card.confidence } : {}),
    };
  });
  const result = palChatResultFromBody({ answer: text(answer.message, 8000), cards, proposals: entry.proposals, toolsUsed: answer.toolsUsed });
  if (result.status === "error") return null;
  const area = record(record(entry.locality)?.area);
  const remembered: RememberedArea | null = area?.kind === "night-patch" && typeof area.id === "string"
    ? { kind: "patch", id: area.id } : area?.kind === "borough" && typeof area.name === "string" ? { kind: "borough", name: area.name } : null;
  const recall = record(entry.recall);
  const originalScope = record(entry.locality)?.scope;
  const heldLocality = resolvePalLocality("", remembered);
  const locality: PalLocality | null = heldLocality.grounded && (originalScope === "query" || originalScope === "remembered") ? { ...heldLocality, scope: originalScope } : query ? resolvePalLocality(query, null) : null;
  return { kind: "answer", id, answer: result, locality, proposals: result.proposals,
    recall: typeof recall?.line === "string" && typeof recall.topic === "string" ? { line: text(recall.line, 1000), topic: text(recall.topic, 200) } : null };
}

/** Restore this owner's facts and proposals. A proposal still needs a fresh tap. */
export async function readPalChatThread(owner: string, now = Date.now()): Promise<PalChatThread | null> {
  const saved = record(readSurfaceSnapshot<unknown>(key(owner), PUB_PAL_CONVERSATION_IDLE_MS, now));
  if (saved?.version !== 2 || !Array.isArray(saved.entries) || !Array.isArray(saved.turns)) return null;
  const entries: PalChatEntry[] = [];
  const priorAsks: string[] = [];
  const turns: AskTurn[] = [];
  for (const raw of saved.entries.slice(-24)) {
    const entry = record(raw);
    if (!entry) return null;
    const id = `t-${entries.length + 1}`;
    if (entry.kind === "user" && typeof entry.text === "string") {
      const query = text(entry.text, 500);
      entries.push({ kind: "user", id, text: query });
      priorAsks.push(query);
    } else if (entry.kind === "answer") {
      const answer = restoreAnswer(entry, id, priorAsks.at(-1));
      if (!answer) return null;
      entries.push(answer);
    } else if (entry.kind === "error" && typeof entry.message === "string") {
      entries.push({ kind: "error", id, message: text(entry.message, 2000), needsSignIn: entry.needsSignIn === true, ...(typeof entry.retryQuery === "string" ? { retryQuery: text(entry.retryQuery, 500) } : {}) });
    } else return null;
  }
  for (const raw of saved.turns) {
    const turn = record(raw);
    if (!turn || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") return null;
    turns.push({ role: turn.role, content: text(turn.content, 8000) });
  }
  const conversationAt = typeof saved.conversationAt === "number" && Number.isFinite(saved.conversationAt) ? saved.conversationAt : 0;
  const conversationId = typeof saved.conversationId === "string" && isPubPalConversationId(saved.conversationId)
    && conversationAt <= now && now - conversationAt < PUB_PAL_CONVERSATION_IDLE_MS ? saved.conversationId : "";
  const recent = await recentPalSessionTurns(turns);
  return { entries, priorAsks: recent.filter((turn) => turn.role === "user").map((turn) => turn.content), turns: recent, conversationId, conversationAt };
}
