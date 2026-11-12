export const PAL_VOICE_START_ERROR = "Voice isn't available. Type instead.";
export const PAL_MICROPHONE_PERMISSION_ERROR =
  "Microphone access is off. Type instead.";
export const PAL_VOICE_START_TIMEOUT_MS = 20_000;
export const PAL_VOICE_START_TIMEOUT_ERROR =
  "Voice took too long to start. Ask in writing or try again.";
/**
 * By default the SDK waits 3 s on Android before it opens the socket, so the
 * phone can switch its audio mode. This override removes that SDK delay.
 */
export const PAL_VOICE_CONNECTION_DELAY = { default: 0, android: 0 } as const;
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

/**
 * Did the Pal end the call on purpose? Its end_call tool and the provider's
 * silence backstop both close the line with code 1000, which the SDK reports
 * as `reason: "agent"`. The panel shows that as a friendly end, not an error.
 */
export function palVoiceEndedByPal(details: unknown): boolean {
  return !!details && typeof details === "object" && (details as { reason?: unknown }).reason === "agent";
}

/**
 * A live call the provider ended on purpose, which the person can carry on
 * from: its own session cap, or the Pal hanging up (palVoiceEndedByPal).
 * Null for a dropped line and for an end the person chose.
 */
export function palVoiceProviderEnd(details: unknown): "cap" | "pal" | null {
  if (palVoiceEndedByPal(details)) return "pal";
  if (!details || typeof details !== "object") return null;
  const { reason, context } = details as { reason?: unknown; context?: unknown };
  const type = context && typeof context === "object" ? (context as { type?: unknown }).type : undefined;
  return reason === "error" && type === "max_duration_exceeded" ? "cap" : null;
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
  begin: () => Promise<void>;
  reportStartupFinished: () => void;
  release: () => void;
};

type MicrophoneStartup = {
  cancelled: boolean;
  streams: Set<VoiceProbeStream>;
  pending: boolean;
  finished: Promise<void>;
};

let currentMicrophoneStartup: MicrophoneStartup | null = null;
let installedMicrophone: {
  mediaDevices: MediaDevices;
  original: MediaDevices["getUserMedia"];
} | null = null;

function startupCancelled(): DOMException {
  return new DOMException("Voice startup was cancelled.", "AbortError");
}

function installPalVoiceMicrophone() {
  const mediaDevices = navigator.mediaDevices;
  if (installedMicrophone?.mediaDevices === mediaDevices) return installedMicrophone;
  const original = mediaDevices.getUserMedia;
  installedMicrophone = { mediaDevices, original };
  currentMicrophoneStartup = null;
  mediaDevices.getUserMedia = async (constraints) => {
    const startup = currentMicrophoneStartup;
    if (startup?.cancelled) throw startupCancelled();
    const stream = await original.call(mediaDevices, constraints);
    if (startup?.cancelled || document.visibilityState === "hidden") {
      stopTracks(stream);
      throw startupCancelled();
    }
    startup?.streams.add(stream);
    return stream;
  };
  return installedMicrophone;
}

export function createPalVoiceMicrophoneHold(): PalVoiceMicrophoneHold {
  let reportStartupFinished!: () => void;
  const finished = new Promise<void>((resolve) => { reportStartupFinished = resolve; });
  const startup: MicrophoneStartup = { cancelled: false, streams: new Set(), pending: true, finished };

  return {
    begin: async () => {
      if (startup.cancelled || !navigator.mediaDevices?.getUserMedia) return;
      installPalVoiceMicrophone();
      while (currentMicrophoneStartup?.pending) {
        if (currentMicrophoneStartup === startup) return;
        await currentMicrophoneStartup.finished;
        if (startup.cancelled) return;
      }
      currentMicrophoneStartup = startup;
    },
    reportStartupFinished: () => {
      startup.pending = false;
      reportStartupFinished();
    },
    release: () => {
      startup.cancelled = true;
      for (const stream of startup.streams) stopTracks(stream);
      startup.streams.clear();
    },
  };
}

export function requestPalVoiceMicrophone(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const { mediaDevices, original } = installPalVoiceMicrophone();
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
