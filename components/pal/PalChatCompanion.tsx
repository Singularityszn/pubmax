"use client";

import { useEffect, useState } from "react";
import { authedActionFetch } from "@/lib/authedFetch";
import { DEFAULT_PAL_DRAFT, type PalAnimationState, type PubPal } from "@/lib/pubPal";
import { palGenomeFor } from "@/lib/palGenome";
import { readLocalPal, subscribeLocalPal } from "@/lib/localPal";
import PalPortrait from "./PalPortrait";

/** The chat keeps the person's selected companion beside the conversation. */
export default function PalChatCompanion({ owner, state }: { owner: string | null; state: PalAnimationState }) {
  const [pal, setPal] = useState<PubPal | null>(null);
  useEffect(() => {
    if (!owner || owner === "anonymous") return;
    let controller: AbortController | null = null;
    const refresh = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      void authedActionFetch("/api/pub-pal", { signal: request.signal }, { requiresIdentity: true })
      .then(async response => {
        if (!response.ok) return;
        const body = await response.json() as { pal?: PubPal | null };
        if (request.signal.aborted) return;
        setPal(body.pal?.ownerId === owner ? body.pal : null);
      })
      .catch(() => { /* The original default companion remains available. */ });
    };
    const unsubscribe = subscribeLocalPal(() => {
      const local = readLocalPal();
      setPal(local?.ownerId === owner ? local : null);
      refresh();
    });
    refresh();
    return () => { unsubscribe(); controller?.abort(); };
  }, [owner]);
  const ownedPal = owner && owner !== "anonymous" && pal?.ownerId === owner ? pal : null;
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
