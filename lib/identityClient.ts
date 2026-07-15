export const IDENTITY_HANDLE_CHANGED_EVENT = "pubmaxx:identity-handle-changed";

export function emitIdentityHandleChanged(handle: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(IDENTITY_HANDLE_CHANGED_EVENT, { detail: { handle } }));
}
