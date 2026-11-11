// Keep these files beside the app so the page's media-src stays 'self'.
// Cue timing and routing: docs/PUB_PAL_SETUP.md#voice-audio-cues-and-routing.

export type PalVoiceSound = "start" | "end" | "map";

export const PAL_VOICE_SOUND_SRC: Record<PalVoiceSound, string> = {
  start: "/sounds/pal/voice-start.mp3",
  end: "/sounds/pal/voice-end.mp3",
  map: "/sounds/pal/open-map.mp3",
};

const VOLUME = 0.4;

export function playPalVoiceSound(sound: PalVoiceSound): (() => void) | undefined {
  if (typeof window === "undefined" || typeof window.Audio !== "function") return;
  try {
    const audio = new window.Audio(PAL_VOICE_SOUND_SRC[sound]);
    audio.volume = VOLUME;
    void audio.play()?.catch(() => {
      // Autoplay refused or the file is missing: the cue is a nicety.
    });
    return () => { audio.pause(); };
  } catch {
    // As above.
  }
}
