import { useEffect, useState } from "react";

import {
  pintDropDraftForPersistence,
  pintDropDraftStorageKey,
  clearPintDropDraft,
  readPintDropDraft,
  seededPintDropDraftForm,
  writePintDropDraft,
} from "@/lib/pintDropDraft";
import { trackEvent } from "@/lib/analytics";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import { safeSessionStorage } from "@/lib/safeStorage";
import { readProviderSignOutRevision } from "@/lib/authProviderRevision";
import type { PintDropsState } from "@/components/map/usePintDrops";

type UseVenueDraftArgs = {
  venueId: string;
  draftOwner: string | null;
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
 * Owns the account-and-venue-scoped draft lifecycle: hydrate on venue switch, persist on
 * every edit, and gate the composer's first interactive paint. Returns
 * `draftReady` — false until the current venue's saved draft has hydrated.
 */
export function useVenueDraft({
  venueId,
  draftOwner,
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
  const storageOwner = draftOwner === "keyless" ? undefined : draftOwner ?? undefined;
  const scope = draftOwner === null ? null : pintDropDraftStorageKey(venueId, storageOwner);
  const [draftReadyScope, setDraftReadyScope] = useState<string | null>(null);
  if (draftReadyScope !== null && draftReadyScope !== scope) {
    // React adjust-state-during-render pattern: block stale shared composer
    // state from painting under a newly selected pub while the venue draft
    // hydrates. The actual field reset happens in the effect below.
    setDraftReadyScope(null);
  }
  const draftReady = scope !== null && draftReadyScope === scope;

  useEffect(() => {
    if (scope === null) return;
    let active = true;
    const signOutRevision = readProviderSignOutRevision("supabase");
    async function hydrateVenueDraft() {
      const draft = readPintDropDraft(safeSessionStorage(), venueId, storageOwner);
      if (!active) return;
      resetComposer();
      const seeded = seededPintDropDraftForm(draft?.form ?? null, priceSeed);
      if (draft) {
        writePintDropDraft(safeSessionStorage(), venueId, draft, storageOwner);
        if (seeded) setDropForm(seeded);
        setVisibility(draft.visibility);
        setVibeTags(draft.vibeTags);
        trackEvent("draft_recovered", { kind: "pint-drop", surface: "map" });
      } else if (seeded) {
        setDropForm(seeded);
      }
      setDraftReadyScope(scope);
    }
    void hydrateVenueDraft();
    return () => {
      active = false;
      if (storageOwner?.startsWith("account:") && readProviderSignOutRevision("supabase") !== signOutRevision) {
        clearPintDropDraft(safeSessionStorage(), venueId, storageOwner);
      }
    };
  }, [venueId, scope, storageOwner, draftOwner, priceSeed, resetComposer, setDropForm, setVisibility, setVibeTags]);

  useEffect(() => {
    if (scope === null || draftReadyScope !== scope) return;
    writePintDropDraft(
      safeSessionStorage(),
      venueId,
      pintDropDraftForPersistence({
        form: dropForm,
        visibility,
        vibeTags,
        updatedAt: new Date().toISOString(),
      }, transientVoiceNoteBaseline),
      storageOwner,
    );
  }, [venueId, scope, storageOwner, draftReadyScope, dropForm, transientVoiceNoteBaseline, visibility, vibeTags]);

  useEffect(() => {
    if (draftReady) markPubmaxTiming("pubmax:composer-interactive");
  }, [draftReady]);

  return draftReady;
}
