"use client";

// A count that moves each time this tab's live account departs.
//
// AuthProvider clears this tab's private storage when the live account leaves
// (`liveAccountDeparted`). A surface that read that storage into React state
// still holds the previous account's copy, shows it to the next person and
// writes it back on their first edit: /plan did exactly that with A's request
// after a switch to B (#2539). Keying such a surface on this count remounts it
// at the same boundary, so it starts again from the storage that was cleared.

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
