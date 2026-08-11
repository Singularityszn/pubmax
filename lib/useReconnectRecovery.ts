"use client";

import { useEffect, useRef } from "react";

const DEFAULT_RECONNECT_RECOVERY_DEBOUNCE_MS = 150;

type RecoveryWindow = Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;
type RecoveryDocument = Pick<Document, "addEventListener" | "removeEventListener"> & {
  visibilityState: DocumentVisibilityState;
};

export type ReconnectRecoveryOptions = {
  debounceMs?: number;
  windowTarget?: RecoveryWindow;
  documentTarget?: RecoveryDocument;
};

function browserWindow(): RecoveryWindow | null {
  return typeof window === "undefined" ? null : window;
}

function browserDocument(): RecoveryDocument | null {
  return typeof document === "undefined" ? null : document;
}

/**
 * Watch browser wake events for one failed surface load.
 *
 * A reconnect and a foreground event close together share one debounced retry.
 * The callback runs once before another browser event can schedule a retry, so a
 * reload that causes its own event cannot create a retry loop.
 */
export function subscribeToReconnectRecovery(
  reload: () => void,
  options: ReconnectRecoveryOptions = {},
): () => void {
  const windowTarget = options.windowTarget ?? browserWindow();
  const documentTarget = options.documentTarget ?? browserDocument();
  if (!windowTarget || !documentTarget) return () => {};

  const debounceMs = options.debounceMs ?? DEFAULT_RECONNECT_RECOVERY_DEBOUNCE_MS;
  let timer: ReturnType<RecoveryWindow["setTimeout"]> | null = null;
  let eventScheduled = false;

  const schedule = () => {
    if (eventScheduled) return;
    eventScheduled = true;
    timer = windowTarget.setTimeout(() => {
      timer = null;
      try {
        reload();
      } finally {
        eventScheduled = false;
      }
    }, debounceMs);
  };
  const onOnline = () => schedule();
  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === "visible") schedule();
  };

  windowTarget.addEventListener("online", onOnline);
  documentTarget.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    windowTarget.removeEventListener("online", onOnline);
    documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
    if (timer !== null) windowTarget.clearTimeout(timer);
    timer = null;
    eventScheduled = false;
  };
}

export function useReconnectRecovery(
  enabled: boolean,
  reload: () => void,
  options: Pick<ReconnectRecoveryOptions, "debounceMs"> = {},
): void {
  const reloadRef = useRef(reload);
  const debounceMs = options.debounceMs;

  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeToReconnectRecovery(
      () => reloadRef.current(),
      debounceMs === undefined ? {} : { debounceMs },
    );
  }, [enabled, debounceMs]);
}
