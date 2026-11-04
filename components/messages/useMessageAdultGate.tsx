"use client";

import { useCallback, useRef, useState, type ReactElement } from "react";

import { ContributionGateDialog } from "@/components/identity/ContributionGateDialog";
import { readContributionGateStatus } from "@/lib/contributionGateStatus";

type AdultMode = "adult_check_required" | "adult_check_failed";

/**
 * The message doors' age refusal, answered where it was raised. A route that
 * says `adult_check_required` (or `adult_check_failed`) gets the shared
 * ContributionGateDialog, so the one tap is offered on the spot, and the held
 * action runs again once the tap is recorded.
 *
 * `fromRefusal` reads a refusal body and says whether it was the age gate: the
 * caller shows its own error line for every other refusal.
 */
export function useMessageAdultGate(): {
  fromRefusal: (body: unknown, retry?: () => void) => boolean;
  adultGateDialog: ReactElement | null;
} {
  const [mode, setMode] = useState<AdultMode | null>(null);
  const retryRef = useRef<(() => void) | null>(null);

  const fromRefusal = useCallback((body: unknown, retry?: () => void) => {
    const status = readContributionGateStatus(
      body && typeof body === "object" ? (body as { status?: unknown }).status : undefined,
    );
    if (status !== "adult_check_required" && status !== "adult_check_failed") return false;
    retryRef.current = retry ?? null;
    setMode(status);
    return true;
  }, []);

  const close = useCallback(() => {
    retryRef.current = null;
    setMode(null);
  }, []);

  const asserted = useCallback(() => {
    const retry = retryRef.current;
    retryRef.current = null;
    setMode(null);
    retry?.();
  }, []);

  return {
    fromRefusal,
    adultGateDialog: mode ? (
      <ContributionGateDialog mode={mode} error={null} onClose={close} onAsserted={asserted} />
    ) : null,
  };
}
