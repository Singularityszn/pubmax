export const PAL_VOICE_START_ERROR = "Voice isn't available. Type instead.";
export const PAL_MICROPHONE_PERMISSION_ERROR =
  "Microphone access is off. Type instead.";
export const PAL_VOICE_START_TIMEOUT_MS = 20_000;
export const PAL_VOICE_START_TIMEOUT_ERROR =
  "Voice took too long to start. Ask in writing or try again.";
export const PAL_VOICE_LINE_DROPPED_ERROR =
  "The voice line dropped, so the Pal stopped hearing you. Start voice chat again or ask in writing.";

/**
 * Did the provider's line drop under a live call, rather than end on purpose?
 *
 * The SDK reports a socket that closed with any code but 1000 as
 * `reason: "error"`. On a phone in a pub that is a weak signal, and the panel
 * used to flip back to "Voice ready" in silence while the person kept talking
 * to nobody. The provider's own session cap also ends as an error, but it is
 * the same three-minute cap the browser keeps, so it says nothing new.
 */
export function palVoiceLineDropped(details: unknown): boolean {
  if (!details || typeof details !== "object") return false;
  const { reason, context } = details as { reason?: unknown; context?: unknown };
  if (reason !== "error") return false;
  const type = context && typeof context === "object" ? (context as { type?: unknown }).type : undefined;
  return type !== "max_duration_exceeded";
}

type VoiceProbeStream = {
  getTracks: () => Array<{ stop: () => void }>;
};

type VoiceStartAttempt<TGrant> = {
  requestMicrophone: () => Promise<VoiceProbeStream>;
  issueGrant: () => Promise<TGrant>;
  connect: (grant: TGrant) => void | Promise<void>;
  onFailure?: (message: string) => void;
  onCancelled?: () => void;
};

type ActiveVoiceStart = {
  cancelled: boolean;
  grantRequestStarted: boolean;
  grantRequestSettled: boolean;
  cancellationNotified: boolean;
  onCancelled?: () => void;
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

function stopTracks(stream: VoiceProbeStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Best effort: one failed stop must not keep the other tracks open.
    }
  }
}

export type PalVoiceMicrophoneHold = {
  /** Waits for the previous startup, then holds SDK streams until startup ends. */
  begin: () => Promise<void>;
  /** Startup ended. The SDK now owns its streams and ends them itself. */
  settle: () => void;
  /** Stops every held stream now, and every stream that opens later in this startup. */
  release: () => void;
};

type MicrophoneHoldState = {
  released: boolean;
  streams: Set<VoiceProbeStream>;
};

let installedMicrophone: {
  mediaDevices: MediaDevices;
  original: MediaDevices["getUserMedia"];
  ownMethod: boolean;
  state: MicrophoneHoldState;
  settled: Promise<void>;
} | null = null;

function startupCancelled(): DOMException {
  return new DOMException("Voice startup was cancelled.", "AbortError");
}

/**
 * Holds the microphone streams that the ElevenLabs SDK opens during one voice
 * startup. The SDK cannot cancel its startup, so `release()` is the only way
 * to close that microphone before the socket finishes. After release, every
 * SDK request fails until that startup settles. The next startup waits for
 * that settlement. App permission probes use
 * `requestPalVoiceMicrophone()` to bypass the SDK holds.
 */
export function createPalVoiceMicrophoneHold(): PalVoiceMicrophoneHold {
  const state: MicrophoneHoldState = { released: false, streams: new Set() };
  let resolveSettled!: () => void;
  const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });

  return {
    begin: async () => {
      const mediaDevices = navigator.mediaDevices;
      if (state.released || !mediaDevices?.getUserMedia) return;
      while (installedMicrophone?.mediaDevices === mediaDevices) {
        if (installedMicrophone.state === state) return;
        await installedMicrophone.settled;
        if (state.released) return;
      }
      const original = mediaDevices.getUserMedia;
      installedMicrophone = {
        mediaDevices,
        original,
        ownMethod: Object.prototype.hasOwnProperty.call(mediaDevices, "getUserMedia"),
        state,
        settled,
      };
      mediaDevices.getUserMedia = async (constraints) => {
        if (state.released) throw startupCancelled();
        const stream = await original.call(mediaDevices, constraints);
        if (state.released) {
          stopTracks(stream);
          throw startupCancelled();
        }
        state.streams.add(stream);
        return stream;
      };
    },
    settle: () => {
      state.streams.clear();
      resolveSettled();
      if (installedMicrophone?.state !== state) return;
      const { mediaDevices, original, ownMethod } = installedMicrophone;
      if (ownMethod) mediaDevices.getUserMedia = original;
      else Reflect.deleteProperty(mediaDevices, "getUserMedia");
      installedMicrophone = null;
    },
    release: () => {
      state.released = true;
      for (const stream of state.streams) stopTracks(stream);
      state.streams.clear();
    },
  };
}

export function requestPalVoiceMicrophone(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const mediaDevices = navigator.mediaDevices;
  const original = installedMicrophone?.mediaDevices === mediaDevices
    ? installedMicrophone.original
    : mediaDevices.getUserMedia;
  return original.call(mediaDevices, constraints);
}

export function createPubPalVoiceStartController() {
  let locked = false;
  let inFlight: Promise<boolean> | null = null;
  let activeStart: ActiveVoiceStart | null = null;

  const notifyCancellation = (start: ActiveVoiceStart): void => {
    if (start.cancellationNotified) return;
    if (!start.grantRequestStarted || !start.grantRequestSettled) return;
    start.cancellationNotified = true;
    start.onCancelled?.();
  };

  return {
    isStarting: () => locked,
    settle: () => {
      locked = false;
    },
    cancel: () => {
      locked = false;
      if (!activeStart) return;
      activeStart.cancelled = true;
      notifyCancellation(activeStart);
      activeStart = null;
      inFlight = null;
    },
    start<TGrant>(attempt: VoiceStartAttempt<TGrant>): Promise<boolean> {
      if (inFlight) return inFlight;
      if (locked) return Promise.resolve(false);
      locked = true;

      const currentStart: ActiveVoiceStart = {
        cancelled: false,
        grantRequestStarted: false,
        grantRequestSettled: false,
        cancellationNotified: false,
        onCancelled: attempt.onCancelled,
      };
      activeStart = currentStart;

      const current = Promise.resolve()
        .then(async () => {
          try {
            const stream = await attempt.requestMicrophone();
            if (currentStart.cancelled) {
              stopTracks(stream);
              return false;
            }
            stopTracks(stream);
            currentStart.grantRequestStarted = true;
            let grant: TGrant;
            try {
              grant = await attempt.issueGrant();
            } catch (error) {
              currentStart.grantRequestSettled = true;
              if (currentStart.cancelled) {
                notifyCancellation(currentStart);
                return false;
              }
              locked = false;
              attempt.onFailure?.(voiceStartErrorMessage(error));
              return false;
            }
            currentStart.grantRequestSettled = true;
            if (currentStart.cancelled) {
              notifyCancellation(currentStart);
              return false;
            }
            await attempt.connect(grant);
            return true;
          } catch (error) {
            if (currentStart.cancelled) return false;
            locked = false;
            attempt.onFailure?.(voiceStartErrorMessage(error));
            return false;
          }
        })
        .finally(() => {
          if (inFlight === current) inFlight = null;
          if (activeStart === currentStart) activeStart = null;
        });
      inFlight = current;
      return current;
    },
  };
}
