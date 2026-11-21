"use client";

// "Tap the pubs you've been to": the optional first-run card that starts a
// person's Been here list (launch plan 1 Nov 2026, the "Keep" row; the rules
// are in lib/beenHere.ts).
//
// WHERE IT SHOWS, AND WHY THERE. On the You tab, never on the map. The map's
// first visit already holds the arrival card, the location ask, the first-run
// tour and the analytics consent card, and the prompt budget lets one of them
// speak per session (docs/PROMPT_ORCHESTRATION.md). The `/u` family paints no
// consent card at all (lib/consentSurfaceRoutes.ts) and the tour is map-only,
// so here the card fights neither. It sits in the page flow like the other
// first-run rows, so it is not an interruptive prompt and claims no budget:
// it covers nothing, blocks nothing, and the page reads the same around it.
//
// ONCE PER DEVICE. "Done" and "Not now" both close the card and mark the
// device. A tap is kept either way.
//
// IT ALSO CARRIES. Mounted on the signed-in owner's own page, it moves any
// waiting taps to the account (lib/beenHereCarry.ts), whether or not the card
// itself is showing, so taps made signed out land once the person signs in.

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useAuth } from "@/components/auth/authContext";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import Kicker from "@/components/ui/kicker";
import {
  BEEN_HERE_COPY,
  BEEN_HERE_FIRST_RUN_PUBS,
  BEEN_HERE_FIRST_RUN_SEEN_KEY,
  beenHereFirstRunWaits,
  hasSeenBeenHereFirstRun,
  markBeenHereFirstRunSeen,
} from "@/lib/beenHere";
import { carryBeenHere, deviceHasBeenHere, tapBeenHere } from "@/lib/beenHereCarry";

import "./beenHereFirstRun.css";

type Phase = "waiting" | "open" | "closed";

function withMember(set: ReadonlySet<string>, id: string, member: boolean): Set<string> {
  const next = new Set(set);
  if (member) next.add(id);
  else next.delete(id);
  return next;
}

export default function BeenHereFirstRun({
  handle = "",
}: {
  /** The signed-in owner's own handle, or empty on the signed-out You tab. */
  handle?: string;
}): React.JSX.Element | null {
  const { user, identityResolved } = useAuth();
  const userId = user?.id ?? "";
  // The account that can receive the taps: a signed-in owner on their own page.
  const accountHandle = userId ? handle.trim() : "";
  const titleId = useId();

  // Waiting taps go to the account whenever its owner opens their own page.
  useEffect(() => {
    if (!identityResolved || !accountHandle || !hasSeenBeenHereFirstRun()) return;
    void carryBeenHere(accountHandle, userId);
  }, [identityResolved, accountHandle, userId]);

  const [phase, setPhase] = useState<Phase>("waiting");
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const decided = useRef(false);
  const dismissedHere = useRef(false);

  // Decide once, after identity has answered: open the card on a device that
  // has not completed or dismissed it. The read runs in
  // a microtask, never in the effect body (react-hooks/set-state-in-effect),
  // and the ref keeps a second run of this effect from deciding twice.
  useEffect(() => {
    if (!identityResolved || decided.current) return;
    decided.current = true;
    void Promise.resolve().then(() => {
      if (hasSeenBeenHereFirstRun() || beenHereFirstRunWaits(window.location.hash)) {
        setPhase("closed");
        return;
      }
      setHeld(
        new Set(
          BEEN_HERE_FIRST_RUN_PUBS.filter((pub) => deviceHasBeenHere(pub.venueId)).map(
            (pub) => pub.venueId,
          ),
        ),
      );
      setPhase("open");
    });
  }, [identityResolved]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === BEEN_HERE_FIRST_RUN_SEEN_KEY &&
        hasSeenBeenHereFirstRun()
      ) {
        setPhase("closed");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const tap = useCallback(
    (venueId: string) => {
      if (hasSeenBeenHereFirstRun()) {
        setPhase("closed");
        return;
      }
      const wanted = !held.has(venueId);
      // The chip answers at once; the device store's own answer settles it.
      setHeld((current) => withMember(current, venueId, wanted));
      void tapBeenHere(
        venueId,
        wanted,
        userId || null,
        () => dismissedHere.current || !hasSeenBeenHereFirstRun(),
      )
        .then((kept) => setHeld((current) => withMember(current, venueId, kept)))
        .catch(() => setHeld((current) => withMember(current, venueId, deviceHasBeenHere(venueId))));
    },
    [held, userId],
  );

  const close = useCallback(() => {
    setPhase("closed");
    if (hasSeenBeenHereFirstRun()) return;
    dismissedHere.current = true;
    markBeenHereFirstRunSeen();
    if (accountHandle) void carryBeenHere(accountHandle, userId);
  }, [accountHandle, userId]);

  if (phase !== "open") return null;

  return (
    <section className="beenHereFirstRun" aria-labelledby={titleId}>
      <Kicker>{BEEN_HERE_COPY.kicker}</Kicker>
      <h2 id={titleId} className="beenHereFirstRunTitle">
        {BEEN_HERE_COPY.title}
      </h2>
      <p className="beenHereFirstRunLead">{BEEN_HERE_COPY.lead}</p>
      <div className="beenHereFirstRunChips" role="group" aria-label={BEEN_HERE_COPY.chipsLabel}>
        {BEEN_HERE_FIRST_RUN_PUBS.map((pub) => (
          <Chip
            key={pub.venueId}
            className="beenHereFirstRunChip"
            aria-pressed={held.has(pub.venueId)}
            aria-label={`${pub.name}, ${pub.area}`}
            data-venue-id={pub.venueId}
            onClick={() => tap(pub.venueId)}
          >
            <span className="beenHereFirstRunName">{pub.name}</span>{" "}
            <span className="beenHereFirstRunArea">{pub.area}</span>
          </Chip>
        ))}
      </div>
      <p className="beenHereFirstRunWhere">
        {accountHandle ? BEEN_HERE_COPY.accountLine : BEEN_HERE_COPY.deviceLine}
      </p>
      <div className="beenHereFirstRunActions">
        <Button type="button" variant="secondary" onClick={close}>
          {BEEN_HERE_COPY.done}
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          {BEEN_HERE_COPY.notNow}
        </Button>
      </div>
    </section>
  );
}
