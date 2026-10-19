// Which confirmed memories reach the Pal on a turn.
//
// Recall used to send the newest eight, so a person's oldest memories never
// reached the model however much the ask was about them: the memory eval's
// long-memory persona asked about wine and the sulphite allergy was left out.
// Now a turn carries every confirmed memory up to PAL_RECALL_MEMORY_LIMIT,
// which covers nearly everyone, and ranks them so the ones that matter come
// first and are the ones kept when someone has more than the limit:
//
// 1. Access needs and corrections always go. A guide dog or a step-free need
//    matters to every pick, and a correction overrides what came before it.
// 2. Then the memories this ask is about: the ask's topic (drink, getting
//    home, atmosphere, the venue itself, a past night) matched to the memory's
//    kind, and the words the two share.
// 3. Then the newest, to fill what is left.
//
// Without an ask (a voice call before its first line), recall is the access
// needs, the corrections and the newest.
//
// Pure leaf: no I/O, no model call, so it adds nothing a person waits for.

import type { PubPalMemoryKind } from "@/lib/pubPal";

/**
 * The most memories one turn carries. Each is at most 200 characters, so this
 * bounds the personal context at about 8 KB however much someone confirms.
 */
export const PAL_RECALL_MEMORY_LIMIT = 40;

const PINNED_KINDS: ReadonlySet<PubPalMemoryKind> = new Set(["accessibility_preference", "correction"]);

const KIND_TOPICS: ReadonlyArray<[PubPalMemoryKind, RegExp]> = [
  ["drink_preference", /\b(?:drinks?|pints?|beers?|ales?|lager|stout|bitter|cider|wine|cocktails?|gin|whisky|spirits?|alcohol|sober|round)\b/i],
  ["transport_preference", /\b(?:home|get(?:ting)? back|trains?|tube|bus|taxi|cab|bikes?|cycl\w*|walk\w*|line|station|journey|travel)\b/i],
  ["atmosphere_preference", /\b(?:quiet|loud|lively|busy|music|band|dj|sports?|football|match|telly|tv|quiz|date|romantic|chat|vibe|crowd|dance)\b/i],
  ["accessibility_preference", /\b(?:step[- ]free|wheelchair|access\w*|stairs|guide dog|toilets?|seats?)\b/i],
  ["venue_preference", /\b(?:pubs?|bars?|place|somewhere|garden|outside|fire\w*|snug|food|eat|dinner|kitchen|late)\b/i],
  ["night_outcome", /\b(?:last time|before|remember|birthday|anniversary|again)\b/i],
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "you", "your", "are", "was", "but", "not", "can", "get",
  "got", "have", "has", "had", "any", "some", "somewhere", "where", "what", "when", "who", "how", "tonight",
  "fancy", "like", "likes", "want", "need", "please", "just", "really", "mates", "near", "pub", "pubs",
]);

/** The four-letter word stems two memory texts are compared on (`lib/palMemoryRelation.ts` reuses them). */
export function palMemoryStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLocaleLowerCase("en-GB").match(/[a-z]+/g) ?? []) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    // Four letters is enough to meet "cycles" and "cycling", "wine" and "wines".
    out.add(word.slice(0, 4));
  }
  return out;
}

type Recallable = { kind: PubPalMemoryKind; value: string };

function relevance(memory: Recallable, askTopics: ReadonlySet<PubPalMemoryKind>, askStems: ReadonlySet<string>): number {
  let shared = 0;
  for (const stem of palMemoryStems(memory.value)) if (askStems.has(stem)) shared += 1;
  return (askTopics.has(memory.kind) ? 2 : 0) + 3 * shared;
}

/**
 * The memories one turn carries, from every confirmed memory given newest
 * first. Pinned kinds first, then the ones this ask is about, then the newest.
 */
export function selectPalMemoriesForAsk<T extends Recallable>(newestFirst: readonly T[], ask: string): T[] {
  const query = ask.trim();
  const pinned = newestFirst.filter((memory) => PINNED_KINDS.has(memory.kind));
  const rest = newestFirst.filter((memory) => !PINNED_KINDS.has(memory.kind));
  const askTopics = new Set(KIND_TOPICS.filter(([, pattern]) => pattern.test(query)).map(([kind]) => kind));
  const askStems = palMemoryStems(query);
  const relevant = rest
    .map((memory, position) => ({ memory, position, score: relevance(memory, askTopics, askStems) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .map((entry) => entry.memory);
  const chosen = new Set<T>([...pinned, ...relevant]);
  const newest = rest.filter((memory) => !chosen.has(memory));
  return [...pinned, ...relevant, ...newest].slice(0, PAL_RECALL_MEMORY_LIMIT);
}
