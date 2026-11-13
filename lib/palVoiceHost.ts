import type { PalAnimationState, PubPalAppearance } from "@/lib/pubPal";
import type { PalGenome } from "@/lib/palGenome";
import type { PalVoiceSignal } from "@/lib/palVoiceSignal";

// One voice call for the whole app. The call lives in PalVoiceHost, in the root
// shell, so a move from /pal to /map keeps the same socket. This leaf holds no
// SDK: the /pal panel registers where the call should draw, and the map chip
// requests startup. The host retains pending starts and engaged calls.

export type PalVoicePanelProps = {
  onStateChange?: (state: PalAnimationState) => void;
  palName?: string;
  signal?: PalVoiceSignal;
  appearance?: PubPalAppearance;
  genome?: PalGenome;
  onMemoryChange?: () => void;
};

export type PalVoiceStartChime = { stop: (() => void) | undefined };

export type PalVoiceHostState = {
  /** The /pal panel's slot, while that page is mounted. */
  panel: { element: HTMLElement; props: PalVoicePanelProps } | null;
  /** The latest panel or map-chip props preserve the Pal's name and look off /pal. */
  props: PalVoicePanelProps | null;
  /** Retain startup, live calls, background interruptions, and visible errors. */
  engaged: boolean;
  /** The call component finished mounting, so the panel needs no loading state. */
  ready: boolean;
  /**
   * A start asked for off /pal, by the map chip. It keeps the call mounted
   * until the call says it is engaged, and `startRequest` counts each ask so a
   * call takes each one once.
   */
  startPending: boolean;
  startRequest: number;
  /** The account that asked. Only that account's call may take the ask. */
  startOwner: string | null;
  stopStartChime?: () => void;
  /** The call's code did not download. Nothing mounts until a new ask. */
  loadFailed: boolean;
};

let state: PalVoiceHostState = {
  panel: null, props: null, engaged: false, ready: false, startPending: false, startRequest: 0, startOwner: null,
  loadFailed: false,
};
const listeners = new Set<() => void>();

function update(next: Partial<PalVoiceHostState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function readPalVoiceHost(): PalVoiceHostState {
  return state;
}

export function subscribePalVoiceHost(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The /pal panel offers its slot. The returned function takes it back. */
export function registerPalVoicePanel(element: HTMLElement, props: PalVoicePanelProps): () => void {
  const panel = { element, props };
  update({ panel, props });
  return () => {
    if (state.panel === panel) update({ panel: null });
  };
}

export function revokePalVoiceCall(): void {
  state.stopStartChime?.();
  update({ panel: null, props: null, engaged: false, ready: false, startPending: false, startOwner: null, stopStartChime: undefined });
}

/** Start a call where the person is, for this account, with its Pal's name and look. */
export function requestPalVoiceStart(ownerId: string, props: PalVoicePanelProps, stopStartChime?: () => void): void {
  state.stopStartChime?.();
  update({ props, startPending: true, startRequest: state.startRequest + 1, startOwner: ownerId, loadFailed: false, stopStartChime });
}

export function takePalVoiceStartChime(): PalVoiceStartChime {
  const chime = { stop: state.stopStartChime };
  update({ stopStartChime: undefined });
  return chime;
}

/** The call's code did not download: drop the ask so the page stays as it was. */
export function palVoiceLoadFailed(): void {
  state.stopStartChime?.();
  update({ loadFailed: true, startPending: false, startOwner: null, stopStartChime: undefined });
}

/** The /pal panel asks for the call's code again. */
export function retryPalVoiceLoad(): void {
  if (state.loadFailed) update({ loadFailed: false });
}

/**
 * Drop an ask no call has taken yet: the person left the call's pages or the
 * account changed, so returning later must not open the microphone by itself.
 */
export function cancelPalVoiceStart(pathname: string, ownerId: string | null, hidden = false): void {
  if (!state.startPending) return;
  if (!hidden && palVoiceCallRoute(pathname) && state.startOwner === ownerId) return;
  state.stopStartChime?.();
  update({ startPending: false, startOwner: null, stopStartChime: undefined });
}

/** An engaged call holds itself mounted, so the start request has done its job. */
export function setPalVoiceEngaged(engaged: boolean): void {
  if (state.engaged !== engaged || (engaged && state.startPending)) {
    update({ engaged, ...(engaged ? { startPending: false } : {}) });
  }
}

export function setPalVoiceReady(ready: boolean): void {
  if (state.ready !== ready) update({ ready });
}

/** The pages one call may move across. Anywhere else ends it, as before. */
function palVoiceCallRoute(pathname: string): boolean {
  return pathname === "/pal" || pathname === "/map" || pathname.startsWith("/map/");
}

/** A cold page with no panel and no call mounts nothing and loads no SDK. */
export function palVoiceCallMounted(host: PalVoiceHostState, pathname: string): boolean {
  if (host.loadFailed) return false;
  return host.panel !== null || ((host.engaged || host.startPending) && palVoiceCallRoute(pathname));
}
