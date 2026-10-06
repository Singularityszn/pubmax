"use client";

// A person's public face and name, for the surfaces that name somebody beside a
// control: the nav chip, the signed-in card on /login, a thread header.
//
// ONE hook over ONE reader (`loadPublicProfileCard`), so those surfaces cannot
// each hold a different answer for the same handle. A card read within the last
// minute is answered from the tab's own snapshot with no request, because the
// nav asks on every page. Anything older is read again, and the owner changing
// their own photo or name announces it (`announceProfileCardChanged`) so no
// surface keeps the old face for the rest of the minute.
//
// The answer is held against the handle it is about, so a switch of account
// never shows the previous person's face over the next one's handle.

import { useEffect, useState } from "react";

import {
  heldPublicProfileCard,
  loadPublicProfileCard,
  PROFILE_CARD_CHANGED_EVENT,
  type PublicProfileCard,
} from "@/components/auth/publicProfileCard";
import { handleOnly } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";

/** How long a read card stands in for another request. */
const PROFILE_CARD_FRESH_MS = 60_000;

export function usePublicProfileCard(handle: string | null | undefined): PublicProfileCard | null {
  const key = handle ? normalizeHandle(handleOnly(handle)) : "";
  const [held, setHeld] = useState<{ key: string; card: PublicProfileCard | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let current = new AbortController();
    // Each read cancels the one before it. A forced read follows a change to the
    // card, so a request already on the wire was sent before that change: it is
    // aborted and its answer is neither painted nor held, and the new read does
    // not join it.
    const read = (force: boolean) => {
      current.abort();
      const controller = new AbortController();
      current = controller;
      const fresh = force ? undefined : heldPublicProfileCard(key, PROFILE_CARD_FRESH_MS);
      void (async () => {
        const card =
          fresh ??
          (await loadPublicProfileCard(key, controller.signal, force ? { fresh: true } : {}));
        if (!controller.signal.aborted && card) setHeld({ key, card });
      })();
    };
    read(false);
    const onChanged = (event: Event) => {
      const changed = (event as CustomEvent<{ handle?: string }>).detail?.handle;
      if (changed && normalizeHandle(handleOnly(changed)) === key) read(true);
    };
    window.addEventListener(PROFILE_CARD_CHANGED_EVENT, onChanged);
    return () => {
      current.abort();
      window.removeEventListener(PROFILE_CARD_CHANGED_EVENT, onChanged);
    };
  }, [key]);

  return held?.key === key ? held.card : null;
}
