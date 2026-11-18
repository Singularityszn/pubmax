"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Retry = { scope: string | null; controller: AbortController };

export function useThreadReadRetry(scope: string | null, refresh: (signal?: AbortSignal) => Promise<void>) {
  const inFlight = useRef<Retry | null>(null);
  const [pending, setPending] = useState<Retry | null>(null);

  useEffect(() => () => {
    inFlight.current?.controller.abort();
  }, [scope, refresh]);

  const retry = useCallback(async () => {
    if (inFlight.current?.scope === scope) return;
    const operation = { scope, controller: new AbortController() };
    inFlight.current = operation;
    setPending(operation);
    try {
      await refresh(operation.controller.signal);
    } finally {
      if (inFlight.current === operation) inFlight.current = null;
      setPending(current => current === operation ? null : current);
    }
  }, [scope, refresh]);

  return { retry, pending: pending !== null && pending.scope === scope };
}
