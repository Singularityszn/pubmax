// Same-origin AudioWorklet files for a strict script-src.
//
// @elevenlabs/client loads its processors from blob: or data: URLs unless a
// session is given paths. scripts/copy_elevenlabs_worklets.mjs copies those
// processors, and the libsamplerate worklet the SDK uses when the device
// sample rate does not match, into public/vendor/elevenlabs. `npm run dev`
// and `npm run build` run that copy through prepare:maplibre-worker. The voice session
// passes these paths into startSession, so script-src never admits data: or
// blob:.

export const ELEVENLABS_WORKLET_PATHS = {
  rawAudioProcessor: "/vendor/elevenlabs/raw-audio-processor.js",
  audioConcatProcessor: "/vendor/elevenlabs/audio-concat-processor.js",
} as const;

/** Loaded only when the AudioContext sample rate differs from the session's. */
export const ELEVENLABS_LIBSAMPLERATE_PATH =
  "/vendor/elevenlabs/libsamplerate.worklet.js";
