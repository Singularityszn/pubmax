// "Take me there", "where is The Lyceum Tavern?", "show The Crown on the map",
// "find The Lamb". The person asks, in their own words, to SEE ONE PUB on the
// map. Pure: it reads the words and the listed pubs it is handed, and never
// guesses. `palVoiceMapIntent` (lib/palVoiceTranscript.ts) answers "pub" for
// these, so the voice panel and the written Pal read the same words the same
// way; each surface then names the pub from what it already holds.
//
// TWO rules. (1) ONLY A LISTED PUB, AND ONLY ONE: a name opens a pub only when
// exactly one listed pub carries it, so "where is The Crown?" with many Crowns
// goes to the Pal, which can ask which one. (2) "THERE" IS THE PUB THE PAL LAST
// NAMED in this conversation (its cards and proposals, or the newest Pal line
// that names a listed pub); with none, nothing is invented.

export type PalMapAskVenue = { id: string; name: string; sourceName?: string };

export type PalMapAskTarget = { kind: "last" } | { kind: "named"; name: string };

function normalizeAsk(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A refusal anywhere in the line is not an ask ("don't take me there").
const NEGATION_RE = /\b(?:don'?t|do not|dont|never|no need to|not|hold off)\b/;
// Polite openers and fillers before the ask itself.
const LEAD = String.raw`^(?:(?:ok|okay|right|so|and|then|yes|yeah|pal|hey|please|great|cool|nice|lovely)\s+)*(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?`;
const TAIL = String.raw`(?:\s+(?:please|then|now|for me|mate))*$`;
const ON_MAP = String.raw`(?:\s+on\s+(?:the\s+|a\s+)?maps?)?`;
const BACK_REF = String.raw`(?:it|that|that one|that pub|that place|this one|this pub|this place|there)`;

const LAST_RES = [
  new RegExp(`${LEAD}(?:take|bring|get|walk)\\s+me\\s+(?:there|to\\s+${BACK_REF})${ON_MAP}${TAIL}`),
  new RegExp(`${LEAD}(?:let'?s\\s+)?go\\s+there${TAIL}`),
  new RegExp(`${LEAD}(?:show|open|find|pull\\s+up)(?:\\s+me)?\\s+${BACK_REF}${ON_MAP}${TAIL}`),
  new RegExp(`${LEAD}show\\s+me\\s+on\\s+(?:the\\s+|a\\s+)?maps?${TAIL}`),
  new RegExp(`${LEAD}where(?:'s|\\s+is)\\s+${BACK_REF}${ON_MAP}${TAIL}`),
  new RegExp(`${LEAD}how\\s+do\\s+i\\s+get\\s+there${TAIL}`),
];

const NAMED_RES = [
  new RegExp(`${LEAD}where(?:'s|\\s+is)\\s+(.+?)${ON_MAP}${TAIL}`),
  new RegExp(`${LEAD}show\\s+me\\s+where\\s+(.+?)\\s+is${ON_MAP}${TAIL}`),
  new RegExp(`${LEAD}(?:show|open|find|locate|pull\\s+up)(?:\\s+me)?\\s+(.+?)\\s+on\\s+(?:the\\s+|a\\s+)?maps?${TAIL}`),
  new RegExp(`${LEAD}(?:find|locate)(?:\\s+me)?\\s+(.+?)${TAIL}`),
  new RegExp(`${LEAD}(?:take|bring|walk)\\s+me\\s+to\\s+(.+?)${ON_MAP}${TAIL}`),
];

// A "name" that is not a pub's: the map itself, a back reference, or a night's
// next stop (that is `palAsksForNextStop`'s, read only while a night is on).
const NOT_A_NAME_RE = new RegExp(`^(?:(?:the|a|my)\\s+)?maps?$|^${BACK_REF}$|\\bnext\\b`);

/** Does the person ask to see one pub on the map, and which? */
export function palMapAskTarget(text: string): PalMapAskTarget | null {
  const normalized = normalizeAsk(text);
  if (!normalized || NEGATION_RE.test(normalized)) return null;
  if (LAST_RES.some((re) => re.test(normalized))) return { kind: "last" };
  for (const re of NAMED_RES) {
    const name = re.exec(normalized)?.[1]?.trim();
    if (!name) continue;
    if (NOT_A_NAME_RE.test(name) || name.split(" ").length > 8) return null;
    return { kind: "named", name };
  }
  return null;
}

/** A pub name as a person would say it: no leading "the", no apostrophes. */
function nameKey(name: string): string {
  return normalizeAsk(name).replace(/'/g, "").replace(/^the\s+/, "");
}

function keysFor(venue: PalMapAskVenue): string[] {
  const keys = [nameKey(venue.name)];
  if (venue.sourceName) keys.push(nameKey(venue.sourceName));
  return keys.filter(Boolean);
}

/**
 * The ONE listed pub with this name ("the lamb pub" is "The Lamb"), or null
 * when none or several carry it.
 */
export function palFindListedVenue(
  name: string,
  venues: readonly PalMapAskVenue[],
): PalMapAskVenue | null {
  const key = nameKey(name);
  const bare = key.replace(/\s+pub$/, "");
  if (!key) return null;
  const found = new Map<string, PalMapAskVenue>();
  for (const venue of venues) {
    const keys = keysFor(venue);
    if (keys.includes(key) || keys.includes(bare)) found.set(venue.id, venue);
  }
  return found.size === 1 ? [...found.values()][0]! : null;
}

/**
 * The pub the newest Pal line names, read from the listed pubs: the longest
 * listed name of two words or more ("The Crown" counts) that the line says
 * whole. Only the newest line that names any listed pub counts, so a pub from
 * an older answer is never opened in place of the one just named; a name
 * several listed pubs share names none of them.
 */
export function palLastNamedVenue(
  palLines: readonly string[],
  venues: readonly PalMapAskVenue[],
): PalMapAskVenue | null {
  for (let index = palLines.length - 1; index >= 0; index -= 1) {
    const line = ` ${normalizeAsk(palLines[index] ?? "").replace(/'/g, "")} `;
    let bestKey = "";
    const best = new Map<string, PalMapAskVenue>();
    for (const venue of venues) {
      const key = normalizeAsk(venue.name).replace(/'/g, "");
      if (key.split(" ").length < 2 || key.length < bestKey.length) continue;
      if (!line.includes(` ${key} `)) continue;
      if (key.length > bestKey.length) {
        bestKey = key;
        best.clear();
      }
      best.set(venue.id, venue);
    }
    if (best.size === 1) return [...best.values()][0]!;
    if (best.size > 1) return null;
  }
  return null;
}

/**
 * The pub a "pub" ask (`palVoiceMapIntent`) opens, or null. `lastVenue` is the
 * pub the surface already holds from the Pal's cards and proposals; the Pal's
 * own lines are read only when it holds none. The listed pubs are loaded only
 * when a name has to be read, and a failed load names nothing.
 */
export async function palPubAskVenue(
  text: string,
  input: {
    lastVenue: PalMapAskVenue | null;
    palLines: readonly string[];
    loadVenues: () => Promise<readonly PalMapAskVenue[]>;
  },
): Promise<PalMapAskVenue | null> {
  const target = palMapAskTarget(text);
  if (!target) return null;
  if (target.kind === "last" && input.lastVenue) return input.lastVenue;
  if (target.kind === "last" && input.palLines.length === 0) return null;
  let venues: readonly PalMapAskVenue[];
  try {
    venues = await input.loadVenues();
  } catch {
    return null;
  }
  return target.kind === "last"
    ? palLastNamedVenue(input.palLines, venues)
    : palFindListedVenue(target.name, venues);
}
