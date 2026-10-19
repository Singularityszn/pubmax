// The live voice levels, shared between the voice panel that owns the session
// and the portrait that reacts to it.
//
// The ElevenLabs session lives inside PubPalVoiceSession, while the Pal's
// portrait sits beside it on /pal. Both read the same two numbers every frame,
// so this is a mutable slot with getters rather than React state: a frame loop
// that set state sixty times a second would re-render the whole Pal home.
// Nothing here is stored or sent, and with no live session every read is zero.

export type PalVoiceSignalMode = "idle" | "connecting" | "listening" | "speaking";

type PalVoiceSignalSource = {
  mode: PalVoiceSignalMode;
  getInputVolume: () => number;
  getOutputByteFrequencyData: () => Uint8Array;
};

type PalVoiceLevels = {
  mode: PalVoiceSignalMode;
  /** The person's microphone level, 0 to 1. */
  input: number;
  /** The Pal's own voice level, 0 to 1. */
  output: number;
};

export type PalVoiceSignal = {
  attach: (source: PalVoiceSignalSource | null) => void;
  read: () => PalVoiceLevels;
};

const SILENT: PalVoiceLevels = { mode: "idle", input: 0, output: 0 };

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * The Pal's speaking level from its output spectrum. Speech sits in the low
 * third of the bins, so the mean of that band is what moves the head.
 */
export function palOutputLevel(spectrum: Uint8Array): number {
  const band = Math.floor(spectrum.length / 3);
  if (band <= 0) return 0;
  let total = 0;
  for (let index = 0; index < band; index += 1) total += spectrum[index] ?? 0;
  return clampUnit(total / band / 255);
}

export function createPalVoiceSignal(): PalVoiceSignal {
  let source: PalVoiceSignalSource | null = null;
  return {
    attach: (next) => {
      source = next;
    },
    read: () => {
      if (!source) return SILENT;
      try {
        return {
          mode: source.mode,
          input: clampUnit(source.getInputVolume()),
          output: palOutputLevel(source.getOutputByteFrequencyData()),
        };
      } catch {
        // A session torn down between frames reads as silence.
        return SILENT;
      }
    },
  };
}
