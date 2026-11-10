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

/** Tracks one Pal reply at a time. Each pick is named once per reply. */
export function createPalPickSpeech() {
  let eventId: number | null = null;
  let spoken = "";
  let named = new Set<number>();

  return {
    /** The picks whose names begin inside this chunk, and when, after the chunk starts. */
    play({ event_id, alignment }: PalPlaybackAlignment, picks: readonly PickName[]): PalPickCue[] {
      if (event_id !== eventId) {
        eventId = event_id;
        spoken = "";
        named = new Set();
      }
      const offset = spoken.length;
      spoken += spokenText(alignment.chars);
      const cues: PalPickCue[] = [];
      for (const pick of picks) {
        if (named.has(pick.number)) continue;
        const pattern = namePattern(pick.name);
        if (!pattern) continue;
        for (const match of spoken.matchAll(pattern)) {
          // A name that began in the chunk before is being heard now.
          const start = match.index + match[0].indexOf(match[1]!);
          named.add(pick.number);
          cues.push({ number: pick.number, delayMs: start < offset ? 0 : Math.max(0, alignment.char_start_times_ms[start - offset] ?? 0) });
          break;
        }
      }
      return cues.sort((a, b) => a.delayMs - b.delayMs);
    },
    reset(): void {
      eventId = null;
      spoken = "";
      named = new Set();
    },
  };
}
