"use client";

import { useEffect } from "react";

export function useSocialIdentityRetry(
  signedInIdentityUnavailable: boolean,
  retryIdentity: () => void,
): void {
  useEffect(() => {
    if (!signedInIdentityUnavailable) return;
    window.addEventListener("online", retryIdentity);
    return () => window.removeEventListener("online", retryIdentity);
  }, [signedInIdentityUnavailable, retryIdentity]);
}
