"use client";

import { useCallback } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { hasPlanActionAccount, keepGuestPlanForSignIn, openPlanSignIn } from "@/lib/planSignIn";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";
import { providerHasAnswered } from "@/lib/authProviderRevision";

export function usePlanActionAccount(onBlocked?: (message: string) => void) {
  const { user, providerAuthState } = useAuth();
  return useCallback(() => {
    if (hasPlanActionAccount(user?.id, providerAuthState)) return true;
    if (!providerHasAnswered(providerAuthState)) {
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
  }, [providerAuthState, user, onBlocked]);
}
