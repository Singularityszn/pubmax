// What the Pal may say it remembers, and where that memory comes from.
//
// IN-THREAD ONLY (ADR 0014 §6). This reads the asks already on screen in this
// conversation and nothing else: no storage, no account read, no durable Pal
// memory. Durable memory stays confirm-gated (ADR 0006), so a line here can
// never be the Pal quietly keeping something the drinker did not approve.
//
// It exists because a companion that has forgotten the question you asked two
// turns ago is not a companion. One quiet line, at most one per answer, naming
// a subject the drinker themselves raised.

import { PAL_RECALL_PLACES } from "@/lib/palRecallPlaces";

/** Words that are in every ask and therefore recall nothing. */
const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "area",
  "around",
  "cheap",
  "cheaper",
  "cheapest",
  "close",
  "drink",
  "drinks",
  "find",
  "five",
  "four",
  "near",
  "neighborhood",
  "neighbourhood",
  "night",
  "patch",
  "place",
  "places",
  "pint",
  "pints",
  "please",
  "pubs",
  "quiet",
  "recommend",
  "round",
  "same",
  "show",
  "some",
  "somewhere",
  "suggest",
  "there",
  "these",
  "thing",
  "things",
  "three",
  "tonight",
  "under",
  "want",
  "what",
  "when",
  "where",
  "which",
  "with",
  "your",
]);

function escapeTopic(topic: string): string {
  const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("'", "['’‘]");
  return topic.toLowerCase() === "bank" ? `${escaped}(?!\\s+holidays?\\b)` : escaped;
}

const TOPIC_PATTERN = new RegExp(`\\b(?:${[
  ...PAL_RECALL_PLACES, "music", "quiz", "garden", "riverside", "cocktails", "heritage", "sports",
].filter((topic) => !STOPWORDS.has(topic.toLowerCase()))
  .sort((a, b) => b.length - a.length).map(escapeTopic).join("|")})\\b`, "gi");

function topics(ask: string): string[] {
  return [...ask.matchAll(TOPIC_PATTERN)].map((match) => match[0].toLowerCase().replace(/[’‘]/g, "'"));
}

/** Print the topic the way the drinker wrote it, not lowercased back at them. */
function asWritten(ask: string, topic: string): string {
  const match = ask.match(new RegExp(`\\b${escapeTopic(topic)}\\b`, "i"));
  return match ? match[0] : topic;
}

export type PalRecall = {
  /** The subject both asks share, spelled as the drinker spelled it. */
  topic: string;
  line: string;
};

/**
 * One recall line for this answer, or none.
 *
 * `priorAsks` is oldest first. The EARLIEST ask that shares a subject wins,
 * because "you asked about this earlier" is about the first time, not the last.
 * An immediate repeat of the previous ask recalls nothing: the drinker can see
 * that turn, and telling them what they just typed is noise, not memory.
 */
export function palRecall(
  priorAsks: readonly string[],
  currentAsk: string,
): PalRecall | null {
  const current = new Set(topics(currentAsk));
  if (current.size === 0) return null;
  // The turn directly above is on screen; recalling it says nothing.
  const older = priorAsks.slice(0, -1);
  for (const ask of older) {
    for (const topic of topics(ask)) {
      if (!current.has(topic)) continue;
      const written = asWritten(ask, topic);
      return {
        topic: written,
        line: `You asked about ${written} earlier.`,
      };
    }
  }
  return null;
}
