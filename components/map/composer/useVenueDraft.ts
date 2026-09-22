import { useEffect, useState } from "react";

import {
  pintDropDraftForPersistence,
  readPintDropDraft,
  seededPintDropDraftForm,
  writePintDropDraft,
  type PintDropDraftSeed,
} from "@/lib/pintDropDraft";
import { trackEvent } from "@/lib/analytics";
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
  transientVoiceNoteBaseline: string | null;
  /**
   * The price or named claim the door carried. Applied INSIDE hydration because
   * `resetComposer()` owns a venue mount. A plain price honours a saved draft;
   * a split claim deliberately seeds price, product and measure together.
   */
  composerSeed?: PintDropDraftSeed | null;
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
  composerSeed = null,
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
      const seeded = seededPintDropDraftForm(draft?.form ?? null, composerSeed);
      if (draft) {
        writePintDropDraft(window.sessionStorage, venueId, draft);
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
  }, [venueId, composerSeed, resetComposer, setDropForm, setVisibility, setVibeTags]);

  useEffect(() => {
    if (draftReadyVenueId !== venueId) return;
    writePintDropDraft(
      typeof window === "undefined" ? null : window.sessionStorage,
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
