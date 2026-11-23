"use client";

import { useCallback } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import { keepGuestPlanForSignIn, openPlanSignIn } from "@/lib/planSignIn";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";

export function usePlanActionAccount(onBlocked?: (message: string) => void) {
  const { signedIn, unresolved } = useViewerSession();
  return useCallback(() => {
    if (signedIn) return true;
    if (unresolved) {
      onBlocked?.("Still checking your sign-in. Try again in a moment.");
      return false;
    }
    if (!keepGuestPlanForSignIn(safeLocalStorage(), safeSessionStorage())) {
      onBlocked?.("Your browser could not keep this Plan for sign-in. Keep this page open and enable site storage.");
      return false;
    }
    const from = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    openPlanSignIn(`/login?from=${encodeURIComponent(from)}`);
    return false;
  }, [signedIn, unresolved, onBlocked]);
}
