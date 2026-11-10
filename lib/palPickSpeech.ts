// Which Pal pick is being named right now, read from the audio as it plays.
// The SDK hands each audio chunk's character timing to the page when that
// chunk starts playing (onAudioAlignmentPlayback) and skips interrupted
// chunks, so a pick pulses when its name is heard, never ahead of the speech.

type PickName = { number: number; name: string };
export type PalPlaybackAlignment = { event_id: number; alignment: { chars: string[]; char_start_times_ms: number[] } };

/** A name as the speech spells it: lower case, every mark a space, "and" optional. */
function namePattern(name: string): RegExp | null {
  const words = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ")
    .filter((word, index) => word && word !== "and" && !(index === 0 && word === "the"));
  if (!words.length) return null;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?:^|\\s)(${escaped.join("\\s+(?:and\\s+)?")})(?=\\s|$)`, "g");
}

function spokenText(chars: readonly string[]): string {
  // One character in, one character out, so a match index is a chunk index.
  return chars.map((char) => (/^[\p{L}\p{N}]$/u.test(char) ? char.toLowerCase() : " ")).join("");
}

export type PalPickCue = { number: number; delayMs: number };

export function createPalPickSpeech() {
  let eventId: number | null = null;
  let spoken = "";
  const processed = new Set<number>();

  return {
    /** The picks whose names begin inside this chunk, and when, after the chunk starts. */
    play({ event_id, alignment }: PalPlaybackAlignment, picks: readonly PickName[]): PalPickCue[] {
      if (event_id !== eventId) {
        eventId = event_id;
        spoken = "";
        processed.clear();
      }
      const offset = spoken.length;
      spoken += spokenText(alignment.chars);
      const matches: { number: number; start: number; end: number }[] = [];
      for (const pick of picks) {
        const pattern = namePattern(pick.name);
        if (!pattern) continue;
        for (const match of spoken.matchAll(pattern)) {
          const start = match.index + match[0].indexOf(match[1]!);
          matches.push({ number: pick.number, start, end: start + match[1]!.length });
        }
      }
      const references: typeof matches = [];
      for (const match of matches.sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
        if (!references.some((other) => match.start < other.end && other.start < match.end)) references.push(match);
      }
      const cues: PalPickCue[] = [];
      for (const { number, start } of references) {
        if (processed.has(start)) continue;
        processed.add(start);
        cues.push({ number, delayMs: start < offset ? 0 : Math.max(0, alignment.char_start_times_ms[start - offset] ?? 0) });
      }
      return cues.sort((a, b) => a.delayMs - b.delayMs);
    },
    reset(): void {
      eventId = null;
      spoken = "";
      processed.clear();
    },
  };
}
