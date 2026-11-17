"use client";

// Storage clearing cannot remove private inputs already held in React state.
// Keying the form on this count discards that copy when its account departs.
// The departure and retention contract lives in
// docs/rules/lib-identity-accounts-and-sessions.md.

import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { liveAccountDeparted } from "@/lib/deviceAccountIdentity";

type LiveAccountBoundary = Readonly<{ accountId: string | null; generation: number }>;

/** Changes when the live account leaves for another account or for nobody. */
export function useLiveAccountGeneration(): number {
  const accountId = useAuth().user?.id ?? null;
  const [boundary, setBoundary] = useState<LiveAccountBoundary>({ accountId, generation: 0 });
  if (boundary.accountId === accountId) return boundary.generation;
  // Adjusting state during render: React re-runs this render with the new
  // boundary before any child commits, so no child renders the old account.
  const generation = liveAccountDeparted(boundary.accountId, accountId)
    ? boundary.generation + 1
    : boundary.generation;
  setBoundary({ accountId, generation });
  return generation;
}
