"use client";

import { useCallback, useEffect, useRef } from "react";

export function useSocialIdentityRetry(
  identityUnavailable: boolean,
  retryIdentity: () => void,
): () => void {
  const retryRequested = useRef(false);
  const requestRetry = useCallback(() => {
    if (retryRequested.current) return;
    retryRequested.current = true;
    retryIdentity();
  }, [retryIdentity]);

  useEffect(() => {
    if (!identityUnavailable) {
      retryRequested.current = false;
      return;
    }
    const retryOnReconnect = () => requestRetry();
    window.addEventListener("online", retryOnReconnect);
    return () => window.removeEventListener("online", retryOnReconnect);
  }, [identityUnavailable, requestRetry]);

  return requestRetry;
}
