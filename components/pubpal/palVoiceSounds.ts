// Three short cues for the voice panel: the line opens, the line closes, and
// the map is on its way. They play only inside a voice chat the person
// started, quietly, and a browser that refuses to play one costs nothing.
// The files are ElevenLabs sound effects, trimmed and levelled to one
// loudness, and live beside the app so the page's media-src stays 'self'.

export type PalVoiceSound = "start" | "end" | "map";

export const PAL_VOICE_SOUND_SRC: Record<PalVoiceSound, string> = {
  start: "/sounds/pal/voice-start.mp3",
  end: "/sounds/pal/voice-end.mp3",
  map: "/sounds/pal/open-map.mp3",
};

const VOLUME = 0.4;

export function playPalVoiceSound(sound: PalVoiceSound): void {
  if (typeof window === "undefined" || typeof window.Audio !== "function") return;
  try {
    const audio = new window.Audio(PAL_VOICE_SOUND_SRC[sound]);
    audio.volume = VOLUME;
    void audio.play()?.catch(() => {
      // Autoplay refused or the file is missing: the cue is a nicety.
    });
  } catch {
    // As above.
  }
}
