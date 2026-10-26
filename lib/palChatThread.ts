"use client";

import { refineRoutedAskQuery, resolveAskLocality, SAME_AREA_REFERENCE_RE } from "@/lib/ask/router";
import { canonicalAskPlaceLabel } from "@/lib/ask/placePhrases";
import type { AskMenuEvidence, AskProposal, AskTurn } from "@/lib/ask/types";
import type { PalAnswer } from "@/lib/palChat";
import { palChatResultFromBody } from "@/lib/palChatClient";
import { resolvePalLocality, type PalLocality } from "@/lib/palLocality";
import { windowPalSessionTurns } from "@/lib/palSessionSummary";
import type { PalRecall } from "@/lib/palRecall";
import { isPubPalConversationId, PUB_PAL_CONVERSATION_IDLE_MS } from "@/lib/pubPalConversationId";
import { readSurfaceSnapshot, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";

/** An answer's routedQuery is the ask its locality was decided from, so a restore decides it again. */
export type PalChatEntry =
  | { kind: "user"; id: string; text: string }
  | { kind: "answer"; id: string; answer: PalAnswer; locality: PalLocality | null; routedQuery?: string; proposals: AskProposal[]; recall: PalRecall | null }
  | { kind: "error"; id: string; message: string; needsSignIn?: boolean; retryQuery?: string };

/** Search results own the map until another search replaces them, including an empty result. */
export function palChatMapAnswer(entries: readonly PalChatEntry[]): Extract<PalChatEntry, { kind: "answer" }> | undefined {
  return entries.findLast((entry): entry is Extract<PalChatEntry, { kind: "answer" }> => entry.kind === "answer"
    && Boolean(entry.answer.toolsUsed?.some((tool) => tool === "search_venues" || tool === "cheapest_pint_near")));
}

/**
 * The one locality decision for a chat answer, made for a fresh answer from its
 * provider history and again on restore. Only a supported, unambiguous search
 * place is named: its planning area when the taxonomy has one, else its
 * canonical search label with no area. With no supported place only the
 * resolver's ungrounded London-wide line stands, so an area the search did not
 * accept is never named. An unresolved same-area reference or an ambiguity
 * names none.
 */
export function palChatLocality(query: string, priorUsers: readonly string[]): { routedQuery: string; locality: PalLocality | null } {
  const routedQuery = refineRoutedAskQuery(query, priorUsers.at(-1), priorUsers);
  const searchLocality = resolveAskLocality(routedQuery);
  const resolved = SAME_AREA_REFERENCE_RE.test(routedQuery) || searchLocality.kind === "ambiguous"
    ? null
    : resolvePalLocality(routedQuery, null);
  const askLocality = resolved && (searchLocality.kind === "supported" || !resolved.grounded) ? resolved : null;
  const searchLabel = askLocality && !askLocality.grounded && !askLocality.askedLondon && searchLocality.kind === "supported"
    ? canonicalAskPlaceLabel(searchLocality.area)
    : null;
  return { routedQuery, locality: searchLabel ? { scope: "query", area: null, label: searchLabel, grounded: true } : askLocality };
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

/** A routed ask is one ask with at most a short earlier ask joined to it. Longer is damage. */
const ROUTED_QUERY_MAX = 1200;

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
export function savePalChatThread(owner: string, entries: PalChatEntry[], conversationId: string, conversationAt: number, turns: readonly AskTurn[]): void {
  writeSurfaceSnapshot(key(owner), { version: 2, entries: entries.slice(-24), conversationId, conversationAt, turns: windowPalSessionTurns("", [...turns]).turns });
}

export function clearPalChatThread(owner: string): void {
  writeSurfaceSnapshot(key(owner), null);
}

function restoreAnswer(entry: Record<string, unknown>, id: string, query: string | undefined, priorUsers: readonly string[]): PalChatEntry | null {
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
  // The saved label and area are not evidence. The answer's own routed ask, or
  // for an older entry its ask and the history before it, is decided again.
  const routed = typeof entry.routedQuery === "string" && entry.routedQuery.length <= ROUTED_QUERY_MAX ? entry.routedQuery : undefined;
  const decided = routed !== undefined ? palChatLocality(routed, []) : query !== undefined ? palChatLocality(query, priorUsers) : null;
  const recall = record(entry.recall);
  return { kind: "answer", id, answer: result, locality: entry.locality === null ? null : decided?.locality ?? null,
    ...(decided ? { routedQuery: decided.routedQuery } : {}), proposals: result.proposals,
    recall: typeof recall?.line === "string" && typeof recall.topic === "string" ? { line: text(recall.line, 1000), topic: text(recall.topic, 200) } : null };
}

/** Restore this owner's facts and proposals. A proposal still needs a fresh tap. */
export function readPalChatThread(owner: string, now = Date.now()): PalChatThread | null {
  const saved = record(readSurfaceSnapshot<unknown>(key(owner), PUB_PAL_CONVERSATION_IDLE_MS, now));
  if (saved?.version !== 2 || !Array.isArray(saved.entries) || !Array.isArray(saved.turns)) return null;
  const turns: AskTurn[] = [];
  for (const raw of saved.turns) {
    const turn = record(raw);
    if (!turn || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") return null;
    turns.push({ role: turn.role, content: text(turn.content, 8000) });
  }
  const recent = windowPalSessionTurns("", turns).turns;
  // An older answer has no routed ask, so its ask is the user line just before
  // it. The saved turns, not the visible thread, are its history: a visible
  // pair borrows the earlier users of the one complete saved exchange whose
  // reply and ask, as typed or as the session window refines it, it repeats.
  // A repeated pair or exchange, a pair the window has dropped and a crossed
  // order all bind nothing, so only a self-contained place can resolve.
  const exchanges = recent.flatMap((turn, index, all) => turn.role === "user" && all[index + 1]?.role === "assistant"
    ? [{ user: turn.content, reply: all[index + 1]!.content, priorUsers: all.slice(0, index).filter((prior) => prior.role === "user").map((prior) => prior.content) }]
    : []);
  const rawEntries = saved.entries.slice(-24);
  const matches = rawEntries.map((raw, index) => {
    const entry = record(raw);
    const previous = record(rawEntries[index - 1]);
    if (entry?.kind !== "answer" || previous?.kind !== "user" || typeof previous.text !== "string") return [];
    const query = text(previous.text, 500);
    const reply = text(record(entry.answer)?.message, 8000);
    return exchanges.flatMap((exchange, at) => exchange.reply === reply && (exchange.user === query
      || windowPalSessionTurns("", [...exchange.priorUsers, query].map((content) => ({ role: "user" as const, content }))).turns.at(-1)?.content === exchange.user) ? [at] : []);
  });
  const bound = matches.map((found) => found.length === 1 && matches.filter((other) => other.includes(found[0]!)).length === 1 ? found[0]! : -1);
  const order = bound.filter((at) => at >= 0);
  const inOrder = order.every((at, index) => index === 0 || at > order[index - 1]!);
  const entries: PalChatEntry[] = [];
  for (const [index, raw] of rawEntries.entries()) {
    const entry = record(raw);
    if (!entry) return null;
    const id = `t-${entries.length + 1}`;
    if (entry.kind === "user" && typeof entry.text === "string") {
      entries.push({ kind: "user", id, text: text(entry.text, 500) });
    } else if (entry.kind === "answer") {
      const previous = entries.at(-1);
      const query = previous?.kind === "user" ? previous.text : undefined;
      const exchange = inOrder && query !== undefined ? exchanges[bound[index] ?? -1] : undefined;
      const answer = restoreAnswer(entry, id, query, exchange?.priorUsers ?? []);
      if (!answer) return null;
      entries.push(answer);
    } else if (entry.kind === "error" && typeof entry.message === "string") {
      entries.push({ kind: "error", id, message: text(entry.message, 2000), needsSignIn: entry.needsSignIn === true, ...(typeof entry.retryQuery === "string" ? { retryQuery: text(entry.retryQuery, 500) } : {}) });
    } else return null;
  }
  const conversationAt = typeof saved.conversationAt === "number" && Number.isFinite(saved.conversationAt) ? saved.conversationAt : 0;
  const conversationId = typeof saved.conversationId === "string" && isPubPalConversationId(saved.conversationId)
    && conversationAt <= now && now - conversationAt < PUB_PAL_CONVERSATION_IDLE_MS ? saved.conversationId : "";
  return { entries, priorAsks: recent.filter((turn) => turn.role === "user").map((turn) => turn.content), turns: recent, conversationId, conversationAt };
}
