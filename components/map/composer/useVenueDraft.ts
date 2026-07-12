import { useEffect, useState } from "react";

import { readPintDropDraft, writePintDropDraft } from "@/lib/pintDropDraft";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import type { PintDropsState } from "@/components/map/usePintDrops";

type UseVenueDraftArgs = {
  venueId: string;
  resetComposer: PintDropsState["resetComposer"];
  setDropForm: PintDropsState["setDropForm"];
  setVisibility: PintDropsState["setVisibility"];
  setVibeTags: PintDropsState["setVibeTags"];
  dropForm: PintDropsState["dropForm"];
  visibility: PintDropsState["visibility"];
  vibeTags: PintDropsState["vibeTags"];
};

/**
 * Owns the venue-scoped draft lifecycle: hydrate on venue switch, persist on
 * every edit, and gate the composer's first interactive paint. Returns
 * `draftReady` — false until the current venue's saved draft has hydrated.
 */
export function useVenueDraft({
  venueId,
  resetComposer,
  setDropForm,
  setVisibility,
  setVibeTags,
  dropForm,
  visibility,
  vibeTags,
}: UseVenueDraftArgs): boolean {
  const [draftReadyVenueId, setDraftReadyVenueId] = useState<string | null>(null);
  if (draftReadyVenueId !== null && draftReadyVenueId !== venueId) {
    // React adjust-state-during-render pattern: block stale shared composer
    // state from painting under a newly selected pub while the venue draft
    // hydrates. The actual field reset happens in the effect below.
    setDraftReadyVenueId(null);
  }
  const draftReady = draftReadyVenueId === venueId;

  useEffect(() => {
    let active = true;
    async function hydrateVenueDraft() {
      const draft = readPintDropDraft(
        typeof window === "undefined" ? null : window.sessionStorage,
        venueId,
      );
      if (!active) return;
      resetComposer();
      if (draft) {
        setDropForm(draft.form);
        setVisibility(draft.visibility);
        setVibeTags(draft.vibeTags);
      }
      setDraftReadyVenueId(venueId);
    }
    void hydrateVenueDraft();
    return () => {
      active = false;
    };
  }, [venueId, resetComposer, setDropForm, setVisibility, setVibeTags]);

  useEffect(() => {
    if (draftReadyVenueId !== venueId) return;
    writePintDropDraft(
      typeof window === "undefined" ? null : window.sessionStorage,
      venueId,
      {
        form: dropForm,
        visibility,
        vibeTags,
        updatedAt: new Date().toISOString(),
      },
    );
  }, [venueId, draftReadyVenueId, dropForm, visibility, vibeTags]);

  useEffect(() => {
    if (draftReady) markPubmaxTiming("pubmax:composer-interactive");
  }, [draftReady]);

  return draftReady;
}
