import type { PalAnimationState, PubPalAppearance } from "@/lib/pubPal";
import type { PalGenome } from "@/lib/palGenome";
import type { PalVoiceSignal } from "@/lib/palVoiceSignal";

// One voice call for the whole app. The call lives in PalVoiceHost, in the root
// shell, so a move from /pal to /map keeps the same socket. This leaf holds no
// SDK: the /pal panel registers where the call should draw, the call says while
// it is in use, and the host reads both to decide whether the call is mounted.

export type PalVoicePanelProps = {
  onStateChange?: (state: PalAnimationState) => void;
  palName?: string;
  signal?: PalVoiceSignal;
  appearance?: PubPalAppearance;
  genome?: PalGenome;
  onMemoryChange?: () => void;
};

export type PalVoiceHostState = {
  /** The /pal panel's slot, while that page is mounted. */
  panel: { element: HTMLElement; props: PalVoicePanelProps } | null;
  /** The last panel's props, so the call keeps its Pal's name and look off /pal. */
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
};

let state: PalVoiceHostState = { panel: null, props: null, engaged: false, ready: false, startPending: false, startRequest: 0 };
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
  update({ panel: null, props: null, engaged: false, ready: false, startPending: false });
}

/** Start a call where the person is, with this Pal's name and look. */
export function requestPalVoiceStart(props: PalVoicePanelProps): void {
  update({ props, startPending: true, startRequest: state.startRequest + 1 });
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
  return host.panel !== null || ((host.engaged || host.startPending) && palVoiceCallRoute(pathname));
}
