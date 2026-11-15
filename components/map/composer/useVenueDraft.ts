import { useEffect, useRef, useState } from "react";

import {
  PINT_DROP_SIGN_IN_RETURN_PARAM,
  pintDropDraftForPersistence,
  isEmptyPintDropDraft,
  readPintDropDraft,
  readLastLoggedDrink,
  takePintDropSignInHandoff,
  writeLastLoggedDrink,
  seededPintDropDraftForm,
  writePintDropDraft,
} from "@/lib/pintDropDraft";
import { authedActionFetch } from "@/lib/authedFetch";
import { readProviderAccountRevision } from "@/lib/authProviderRevision";
import { deviceAccountOwner, readDeviceAccountSessionRevision } from "@/lib/deviceAccountIdentity";
import { trackEvent } from "@/lib/analytics";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";
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
  accountId: string | null;
  accountHandle: string | null;
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
  accountId,
  accountHandle,
}: UseVenueDraftArgs): boolean {
  const revision = readDeviceAccountSessionRevision();
  const seededDrink = useRef<string | null>(null);
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
      const draft = (accountId ? takePintDropSignInHandoff(safeLocalStorage(), venueId, new URLSearchParams(window.location.search).get(PINT_DROP_SIGN_IN_RETURN_PARAM)) : null)
        ?? readPintDropDraft(safeSessionStorage(), venueId);
      if (!active) return;
      resetComposer();
      const ownedAccount = accountId && deviceAccountOwner(safeLocalStorage()) === accountId ? accountId : null;
      const lastDrink = draft ? null : readLastLoggedDrink(safeLocalStorage(), ownedAccount);
      seededDrink.current = lastDrink;
      const seeded = seededPintDropDraftForm(draft?.form ?? null, priceSeed, lastDrink);
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
      if (!draft && !lastDrink && ownedAccount && accountHandle) {
        const accountRevision = readProviderAccountRevision();
        const expectedDrink = seeded?.drink ?? "";
        const query = new URLSearchParams({ author: accountHandle });
        void authedActionFetch(`/api/pint-drops?${query}`, {}, { requiresIdentity: true })
          .then((response) => response.ok ? response.json() : null)
          .then((data: { drops?: Array<{ drink?: unknown }> } | null) => {
            if (!active || accountRevision !== readProviderAccountRevision() || deviceAccountOwner(safeLocalStorage()) !== ownedAccount || !Array.isArray(data?.drops)) return;
            const drink = data.drops.map((drop) => typeof drop.drink === "string" ? drop.drink.trim() : "").find(Boolean);
            if (!drink || readLastLoggedDrink(safeLocalStorage(), ownedAccount)) return;
            writeLastLoggedDrink(safeLocalStorage(), ownedAccount, drink);
            setDropForm((current) => {
              if (current.drink !== expectedDrink) return current;
              seededDrink.current = drink;
              return { ...current, drink };
            });
          }).catch(() => undefined);
      }
    }
    void hydrateVenueDraft();
    return () => {
      active = false;
    };
  }, [venueId, priceSeed, accountId, accountHandle, resetComposer, setDropForm, setVisibility, setVibeTags]);

  useEffect(() => {
    if (revision !== readDeviceAccountSessionRevision() || draftReadyVenueId !== venueId) return;
    const draft = pintDropDraftForPersistence({
      form: dropForm,
      visibility,
      vibeTags,
      updatedAt: new Date().toISOString(),
    }, transientVoiceNoteBaseline);
    const withoutSeed = { ...draft, form: { ...draft.form, drink: "" } };
    writePintDropDraft(safeSessionStorage(), venueId,
      seededDrink.current !== null && draft.form.drink === seededDrink.current && isEmptyPintDropDraft(withoutSeed)
        ? withoutSeed : draft);

  }, [revision, venueId, draftReadyVenueId, dropForm, transientVoiceNoteBaseline, visibility, vibeTags]);

  useEffect(() => {
    if (draftReady) markPubmaxTiming("pubmax:composer-interactive");
  }, [draftReady]);

  return draftReady;
}
