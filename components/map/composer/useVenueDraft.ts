import { useEffect, useState } from "react";

import {
  pintDropDraftForPersistence,
  readPintDropDraft,
  seededPintDropDraftForm,
  writePintDropDraft,
} from "@/lib/pintDropDraft";
import { trackEvent } from "@/lib/analytics";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import { safeSessionStorage } from "@/lib/safeStorage";
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
  transientVoiceNoteBaseline: string | null;
  /**
   * #1462 — the figure the log intent carried, or null. Applied INSIDE the
   * hydration below, because that is where a venue's fields are decided: a seed
   * written from outside is blanked by the `resetComposer()` on this venue's
   * own mount. A saved draft wins, and a draft with no price of its own still
   * takes the seed, so the door's promise survives a half-typed note.
   */
  priceSeed?: string | null;
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
  transientVoiceNoteBaseline,
  priceSeed = null,
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
      const draft = readPintDropDraft(safeSessionStorage(), venueId);
      if (!active) return;
      resetComposer();
      const seeded = seededPintDropDraftForm(draft?.form ?? null, priceSeed);
      if (draft) {
        writePintDropDraft(safeSessionStorage(), venueId, draft);
        if (seeded) setDropForm(seeded);
        setVisibility(draft.visibility);
        setVibeTags(draft.vibeTags);
        trackEvent("draft_recovered", { kind: "pint-drop", surface: "map" });
      } else if (seeded) {
        setDropForm(seeded);
      }
      setDraftReadyVenueId(venueId);
    }
    void hydrateVenueDraft();
    return () => {
      active = false;
    };
  }, [venueId, priceSeed, resetComposer, setDropForm, setVisibility, setVibeTags]);

  useEffect(() => {
    if (draftReadyVenueId !== venueId) return;
    writePintDropDraft(
      safeSessionStorage(),
      venueId,
      pintDropDraftForPersistence({
        form: dropForm,
        visibility,
        vibeTags,
        updatedAt: new Date().toISOString(),
      }, transientVoiceNoteBaseline),
    );
  }, [venueId, draftReadyVenueId, dropForm, transientVoiceNoteBaseline, visibility, vibeTags]);

  useEffect(() => {
    if (draftReady) markPubmaxTiming("pubmax:composer-interactive");
  }, [draftReady]);

  return draftReady;
}
