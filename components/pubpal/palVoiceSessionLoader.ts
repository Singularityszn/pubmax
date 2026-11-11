import type PubPalVoiceSession from "@/components/pubpal/PubPalVoiceSession";

export type PalVoiceSessionComponent = typeof PubPalVoiceSession;

let loading: Promise<PalVoiceSessionComponent> | null = null;

/**
 * The voice call's code, with the ElevenLabs SDK. Fetched once, on the first
 * sign the person wants voice. A failed fetch is forgotten, so the next tap
 * fetches it again.
 */
export function loadPalVoiceSession(): Promise<PalVoiceSessionComponent> {
  loading ??= import("@/components/pubpal/PubPalVoiceSession").then(
    (module) => module.default,
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}
