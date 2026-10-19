// What the voice panel shows of a live Pub Pal session, and the one spoken
// command the browser acts on by itself.
//
// The panel's copy of the transcript lives in the tab: it is never written to
// browser storage, and a reload or a closed tab forgets it. This panel sends
// nothing new. The person's own lines already reach the server's short-lived
// tool turn (`/api/pub-pal/tool-turn`, expired two minutes after the last line
// and purged by cron) so the Pal's tools can read the ask, and none of it
// becomes a memory.
//
// "Show me the map" is read from the PERSON's own words, never the agent's.
// The agent may only PROPOSE a map move (ADR 0006); a person asking for the
// map in their own voice is the same as tapping the Map link, so the panel
// opens /map with a beat to say "stay here".

export type PalVoiceSpeaker = "you" | "pal";

export type PalVoiceLine = {
  id: string;
  speaker: PalVoiceSpeaker;
  text: string;
  /** Typed lines are marked so the reader can tell what the Pal heard. */
  via: "voice" | "typed";
};

/** The transcript keeps the newest lines; a long night does not grow the tab. */
export const PAL_VOICE_TRANSCRIPT_MAX_LINES = 40;

/** How long the "Opening the map" card waits for "Stay here". */
export const PAL_VOICE_MAP_DELAY_MS = 1_400;

export const PAL_VOICE_MAP_HREF = "/map";

let lineCounter = 0;

export function palVoiceLine(
  speaker: PalVoiceSpeaker,
  text: string,
  via: PalVoiceLine["via"] = "voice",
): PalVoiceLine {
  lineCounter += 1;
  return { id: `pal-voice-${lineCounter}`, speaker, text: text.trim(), via };
}

/**
 * Adds one line. An empty line adds nothing, and neither does the Pal sending
 * its last line again. The person saying the same thing twice ("yes", "yes")
 * is two lines, so their lines are never folded.
 */
export function appendPalVoiceLine(
  lines: readonly PalVoiceLine[],
  line: PalVoiceLine,
): PalVoiceLine[] {
  if (!line.text) return [...lines];
  const last = lines.at(-1);
  if (line.speaker === "pal" && last?.speaker === "pal" && last.text === line.text) return [...lines];
  return [...lines, line].slice(-PAL_VOICE_TRANSCRIPT_MAX_LINES);
}

/**
 * When the person talks over the Pal, the provider sends what the Pal really
 * got to say. The newest Pal line that matches the original is cut to it.
 */
export function correctPalVoiceLine(
  lines: readonly PalVoiceLine[],
  original: string,
  corrected: string,
): PalVoiceLine[] {
  const from = original.trim();
  const to = corrected.trim();
  const next = [...lines];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const line = next[index];
    if (line?.speaker !== "pal" || line.text !== from) continue;
    if (!to) next.splice(index, 1);
    else next[index] = { ...line, text: to };
    return next;
  }
  return next;
}

/**
 * The partial words the provider has heard so far, when the agent sends
 * `tentative_user_transcript`. The SDK has no callback for it and hands it to
 * `onDebug` raw, so anything else that arrives there answers null.
 */
export function tentativeUserTranscriptFrom(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const value = event as {
    type?: unknown;
    tentative_user_transcription_event?: { user_transcript?: unknown };
  };
  if (value.type !== "tentative_user_transcript") return null;
  const text = value.tentative_user_transcription_event?.user_transcript;
  return typeof text === "string" ? text.trim() : null;
}

const MAP_NEGATION_RE = /\b(?:don'?t|do not|dont|never|no need to|not|stop)\b/;
// A verb that asks to SEE the map, at most four words before it: "show me
// the map", "can you open up the pub map", "take me back to the map".
const MAP_VERB_RE =
  /\b(?:show|open|see|view|pull up|bring up|load|display|go to|go back to|back to|take me to|take me back to|switch to|get me|give me|let me see)\b(?:\s+[a-z']+){0,4}?\s+maps?\b/;
// The whole ask is the map: "map", "the map please", "map view".
const BARE_MAP_RE = /^(?:(?:the|a|my)\s+)?maps?(?:\s+view)?(?:\s+(?:please|now|then))?$/;

/** Does the person ask, in their own words, to see the map? */
export function palAsksForMap(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || !/\bmaps?\b/.test(normalized)) return false;
  if (BARE_MAP_RE.test(normalized)) return true;
  const verb = MAP_VERB_RE.exec(normalized);
  if (!verb) return false;
  // "Don't show me the map" and "not the map yet" are not asks.
  return !MAP_NEGATION_RE.test(normalized.slice(0, verb.index + verb[0].length));
}
