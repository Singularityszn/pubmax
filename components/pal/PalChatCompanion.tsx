"use client";

import { useEffect, useMemo, useState } from "react";
import { authedActionFetch } from "@/lib/authedFetch";
import { DEFAULT_PAL_DRAFT, type PalAnimationState, type PubPal } from "@/lib/pubPal";
import { palGenomeFor } from "@/lib/palGenome";
import { useAuth } from "@/components/auth/authContext";
import { useOwnPal } from "./useOwnPal";
import PalPortrait from "./PalPortrait";

/** The chat keeps the person's selected companion beside the conversation. */
export default function PalChatCompanion({ owner, state }: { owner: string | null; state: PalAnimationState }) {
  const localPal = useOwnPal();
  const { user, loading, getCurrentUserId } = useAuth();
  const accountId = !loading && user && getCurrentUserId() === user.id ? user.id : null;
  const source = useMemo(() => ({ owner, accountId, localPal }), [owner, accountId, localPal]);
  const [loaded, setLoaded] = useState<{ pal: PubPal | null; source: typeof source } | null>(null);
  useEffect(() => {
    const { owner, accountId } = source;
    if (!accountId || owner !== accountId) return;
    const request = new AbortController();
    void authedActionFetch("/api/pub-pal", { signal: request.signal }, { requiresIdentity: true })
      .then(async response => {
        if (!response.ok) return;
        const body = await response.json() as { pal?: PubPal | null };
        if (request.signal.aborted) return;
        setLoaded({ pal: body.pal?.ownerId === owner ? body.pal : null, source });
      })
      .catch(() => {});
    return () => request.abort();
  }, [source]);
  const candidate = loaded?.source === source ? loaded.pal : localPal;
  const ownedPal = owner === accountId && candidate?.ownerId === accountId && !candidate.hidden ? candidate : null;
  return (
    <div className="palChatCompanion">
      <PalPortrait
        appearance={ownedPal?.appearance ?? DEFAULT_PAL_DRAFT.appearance}
        name={ownedPal?.name ?? "Pub Pal"}
        state={ownedPal?.muted ? "sleeping" : state}
        genome={ownedPal ? palGenomeFor(ownedPal.id, ownedPal.personality) : undefined}
      />
    </div>
  );
}
