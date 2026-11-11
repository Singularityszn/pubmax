"use client";

import { useEffect, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";

export type PalVoiceEligibility = "asking" | "eligible" | "refused";

/**
 * Whether the signed-in owner may be offered Pal voice: the server's stored
 * date-of-birth rule (`under18` on GET /api/pub-pal). Anything short of an
 * explicit `under18: false` refuses, so an unknown answer offers nothing.
 */
export function usePalVoiceEligibility(ownerId: string): PalVoiceEligibility {
  const [answer, setAnswer] = useState<{ ownerId: string; eligibility: PalVoiceEligibility } | null>(null);
  useEffect(() => {
    const request = new AbortController();
    void authedActionFetch("/api/pub-pal", { signal: request.signal }, { requiresIdentity: true })
      .then(async (response) => {
        const body = response.ok ? await response.json() as { under18?: unknown } : null;
        if (!request.signal.aborted) setAnswer({ ownerId, eligibility: body?.under18 === false ? "eligible" : "refused" });
      })
      .catch(() => {
        if (!request.signal.aborted) setAnswer({ ownerId, eligibility: "refused" });
      });
    return () => request.abort();
  }, [ownerId]);
  return answer?.ownerId === ownerId ? answer.eligibility : "asking";
}
