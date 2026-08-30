export const PAL_VOICE_START_ERROR = "Voice is unavailable. Use text instead.";
export const PAL_MICROPHONE_PERMISSION_ERROR =
  "Microphone access is off. Use text instead.";

type VoiceProbeStream = {
  getTracks: () => Array<{ stop: () => void }>;
};

type VoiceStartAttempt<TGrant> = {
  requestMicrophone: () => Promise<VoiceProbeStream>;
  issueGrant: () => Promise<TGrant>;
  connect: (grant: TGrant) => void;
  onFailure?: (message: string) => void;
};

export class PubPalVoiceStartError extends Error {}

function voiceStartErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return PAL_MICROPHONE_PERMISSION_ERROR;
  }
  if (error instanceof PubPalVoiceStartError) return error.message;
  return PAL_VOICE_START_ERROR;
}

function stopProbe(stream: VoiceProbeStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Best effort. Permission is already resolved and the SDK opens its own stream.
    }
  }
}

export function createPubPalVoiceStartController() {
  let locked = false;
  let inFlight: Promise<boolean> | null = null;

  return {
    isStarting: () => locked,
    settle: () => {
      locked = false;
    },
    start<TGrant>(attempt: VoiceStartAttempt<TGrant>): Promise<boolean> {
      if (inFlight) return inFlight;
      if (locked) return Promise.resolve(false);
      locked = true;

      const current = Promise.resolve()
        .then(async () => {
          try {
            const stream = await attempt.requestMicrophone();
            stopProbe(stream);
            const grant = await attempt.issueGrant();
            attempt.connect(grant);
            return true;
          } catch (error) {
            locked = false;
            attempt.onFailure?.(voiceStartErrorMessage(error));
            return false;
          }
        })
        .finally(() => {
          inFlight = null;
        });
      inFlight = current;
      return current;
    },
  };
}
