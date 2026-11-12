"use client";

// THE VENUE SHEET'S ACTION CARD (launch plan 1 Nov 2026, section 5). Airbnb's
// reservation card for a pub: one compact card that stays in view while the
// Overview scrolls. Its first row is the price with its trust words and date,
// the walk if known and the ONE coral door (VenueActionSummary, built by the map
// from the sheet's own readings); under it, "Ask for a table", "Summon mates"
// and Share. A summon link (`?meet=<HH:MM>`) adds one line naming its time.
//
// WHERE IT SITS. Inside the phone's portal sheet it renders into the footer
// slot (components/mobile/sheetFooterContext.ts), a flex child below the
// scroll body, so it rides with the sheet and sits above the safe area. With
// no footer slot (641px and wider) it renders in place under the sheet's head
// and venueActionCard.css makes it the sticky top of the drawer.
//
// IT ADDS NO BLOCK. It is the peek row and the old command bar made one: the
// plan door, the price and the walk left the top of the body, and the
// desktop's Stop 1 and Crawl ghosts and its Overview "Add to crawl" left with
// them, because the card's one door owns all three. Nothing on it appears
// twice on the sheet.
//
// lib/venuePlanDoor.ts decides the primary action. The action-card rule in
// docs/rules/components-venue-plan-and-message-surfaces.md owns its priority
// and the treatment of secondary actions.

import dynamic from "next/dynamic";
import { useEffect, useEffectEvent, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Megaphone, Share2, Users } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import { ContributionGateDialog } from "@/components/identity/ContributionGateDialog";
import { useSheetFooterSlot } from "@/components/mobile/sheetFooterContext";
import LastOrdersBellSlot from "@/components/wild/LastOrdersBellSlot";
import type { ContributionGateStatus } from "@/lib/contributionGateStatus";
import { readProviderAccountRevision, subscribeProviderIdentityRevision } from "@/lib/authProviderRevision";
import { TABLE_REQUEST_ACTION_LABEL } from "@/lib/tableRequests";
import { consumeTableRequestIntent } from "@/lib/tableRequestIntent";
import { venueTableRequestUrl } from "@/lib/venueMapUrl";
import {
  SUMMON_ACTION_LABEL,
  summonArrivalLine,
  summonTimeFromSearch,
} from "@/lib/summonMates";
import type { ShareFeedback } from "@/lib/venueShare";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

import "./venueActionCard.css";

// The form is its own chunk: most sheets never open it.
const TableRequestDialog = dynamic(() => import("./TableRequestDialog"), { ssr: false });
const SummonMatesDialog = dynamic(() => import("./SummonMatesDialog"), { ssr: false });

export default function VenueActionCard({
  venue,
  summary,
  planDoor = null,
  shareVenue,
  currentShareFeedback,
  acceptanceError = null,
}: {
  venue: Venue;
  /** The price, the walk and the coral door, read by the map (VenueActionSummary). */
  summary?: ReactNode;
  /** The plan door as a ghost, when the first row's coral asks for a price. */
  planDoor?: ReactNode;
  shareVenue: () => Promise<void>;
  currentShareFeedback: ShareFeedback | null;
  acceptanceError?: string | null;
}) {
  const footerSlot = useSheetFooterSlot();
  const { configured, loading, user, handle } = useAuth();
  const accountRevision = useSyncExternalStore(subscribeProviderIdentityRevision, readProviderAccountRevision, () => 0);
  const pub = isPubVenue(venue);
  // Kept by venue id, so selecting another pub never carries a half-typed
  // request or an open gate across.
  const [tableVenueId, setTableVenueId] = useState<string | null>(null);
  const [initialPartySize, setInitialPartySize] = useState<number | undefined>();
  const [gate, setGate] = useState<{ venueId: string; status: ContributionGateStatus } | null>(null);
  const [summonVenueId, setSummonVenueId] = useState<string | null>(null);
  const [arrival, setArrival] = useState<{ venueId: string; time: string } | null>(null);
  const tableOpen = tableVenueId === venue.id;
  const summonOpen = summonVenueId === venue.id;
  const arrivalTime = arrival?.venueId === venue.id ? arrival.time : null;
  const gateStatus = gate?.venueId === venue.id ? gate.status : null;

  // Signed in with a handle, or a deployment with no sign-in at all (where the
  // form can only ever hand back the pub's own address). The age question is
  // the server's to ask, and the form answers it with the same gate. A session
  // still resolving opens the form too: the route gates the send.
  function askForTable(partySize?: number): void {
    setInitialPartySize(partySize);
    if (configured && !loading && !user) {
      setGate({ venueId: venue.id, status: "sign_in_required" });
      return;
    }
    if (configured && !loading && user && !handle) {
      setGate({ venueId: venue.id, status: "onboarding_required" });
      return;
    }
    setGate(null);
    setTableVenueId(venue.id);
  }

  // Take the consumed ask out of the address, keeping every other param.
  function clearTableAsk(search: string): void {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
    );
  }

  // A signed-out reader who declines the gate has declined the ask: the
  // address stops carrying it, or the next visit reopens the gate.
  function closeGate(): void {
    const intent = consumeTableRequestIntent(window.location.search, venue.id, pub);
    if (intent) clearTableAsk(intent.search);
    setGate(null);
  }

  // The Pal handoff: /map?sel=<id>&table=<n> opens this pub's form with the
  // crew size prefilled, behind the same gate as the card's own button. The
  // sign-in gate keeps the ask in the address, because sign-in leaves the
  // page and the return reads the address again; every other outcome consumes
  // it at once. Auth still resolving waits, so a settled answer, not the
  // arrival order, picks the door.
  const openTableArrival = useEffectEvent((partySize: number, consumedSearch: string) => {
    if (configured && (!user || !handle)) {
      askForTable(partySize);
      return;
    }
    clearTableAsk(consumedSearch);
    askForTable(partySize);
  });
  useEffect(() => {
    if (loading) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const intent = consumeTableRequestIntent(window.location.search, venue.id, pub);
      if (!intent) return;
      if (intent.partySize === null) {
        clearTableAsk(intent.search);
        return;
      }
      openTableArrival(intent.partySize, intent.search);
    });
    return () => { active = false; };
  }, [venue.id, pub, loading, user?.id, handle]);

  // A summon link names a time for this pub. The address keeps it while this
  // pub stays selected; a new selection drops it (lib/mapSelectionHistory.ts).
  useEffect(() => {
    if (!pub) return;
    const time = summonTimeFromSearch(window.location.search, venue.id);
    if (!time) return;
    queueMicrotask(() => setArrival({ venueId: venue.id, time }));
  }, [venue.id, pub]);

  const card = (
    <div
      className="venueActionCard"
      data-venue-action-card=""
      role="group"
      aria-label={`${venue.name}, price and actions`}
    >
      {/* The wild Last Orders Bell: nothing while the wild switch is off. */}
      <LastOrdersBellSlot
        venueId={venue.id}
        venueName={venue.name}
        lat={venue.latitude}
        lng={venue.longitude}
        variant="sheet"
      />
      {summary}
      {arrivalTime ? (
        <p className="venueSummonArrival" data-venue-summon-arrival="">
          {summonArrivalLine(arrivalTime)}
        </p>
      ) : null}
      <div className="venueSheetStickyBar venueActionCardActions" role="toolbar" aria-label="Venue actions">
        {planDoor}
        {pub ? (
          <button
            type="button"
            className="venueSheetStickyGhost"
            aria-haspopup="dialog"
            aria-label={`${TABLE_REQUEST_ACTION_LABEL} at ${venue.name}`}
            onClick={() => askForTable()}
          >
            <Users size={16} aria-hidden="true" />
            {TABLE_REQUEST_ACTION_LABEL}
          </button>
        ) : null}
        {pub ? (
          <button
            type="button"
            className="venueSheetStickyGhost"
            data-venue-summon=""
            aria-haspopup="dialog"
            aria-label={`${SUMMON_ACTION_LABEL} to ${venue.name}`}
            onClick={() => setSummonVenueId(venue.id)}
          >
            <Megaphone size={16} aria-hidden="true" />
            {SUMMON_ACTION_LABEL}
          </button>
        ) : null}
        <button
          type="button"
          className="venueSheetStickyGhost"
          data-venue-share=""
          onClick={() => {
            void shareVenue();
          }}
          aria-label={`Share ${venue.name}`}
        >
          <Share2 size={16} aria-hidden="true" />
          <span>Share</span>
        </button>
        {currentShareFeedback ? (
          <span
            role={currentShareFeedback.tone === "error" ? "alert" : "status"}
            className={`venueSheetShareFeedback ${currentShareFeedback.tone}`}
          >
            {currentShareFeedback.text}
          </span>
        ) : null}
        {acceptanceError ? (
          <span role="alert" className="venueSheetShareFeedback error">
            {acceptanceError}
          </span>
        ) : null}
      </div>
      {tableOpen ? (
        <TableRequestDialog
          key={venue.id}
          venue={venue}
          initialPartySize={initialPartySize}
          source={initialPartySize === undefined ? "sheet" : "pal"}
          onClose={() => setTableVenueId(null)}
        />
      ) : null}
      {summonOpen ? (
        <SummonMatesDialog key={`${venue.id}:${accountRevision}`} venue={venue} onClose={() => setSummonVenueId(null)} />
      ) : null}
      {gateStatus ? (
        <ContributionGateDialog
          mode={gateStatus}
          error={null}
          onClose={closeGate}
          returnTo={initialPartySize === undefined ? undefined : venueTableRequestUrl(venue.id, initialPartySize)}
        />
      ) : null}
    </div>
  );

  return footerSlot ? createPortal(card, footerSlot) : card;
}
