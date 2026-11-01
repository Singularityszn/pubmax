"use client";

// THE VENUE SHEET'S ACTION CARD (launch plan 1 Nov 2026, section 5). Airbnb's
// reservation card for a pub: one compact card that stays in view while the
// Overview scrolls. Its first row is the price with its trust words and date,
// the walk if known and the ONE plan door (VenueActionSummary, built by the map
// from the sheet's own readings); under it, "Ask for a table" and Share.
//
// WHERE IT SITS. Inside the phone's portal sheet it renders into the footer
// slot (components/mobile/sheetFooterContext.ts), a flex child below the
// scroll body, so it rides with the sheet and sits above the safe area. With
// no footer slot (641px and wider) it renders in place under the sheet's head
// and venueSheet.css makes it the sticky top of the drawer.
//
// IT ADDS NO BLOCK. It is the peek row and the old command bar made one: the
// plan door, the price and the walk left the top of the body, and the
// desktop's Stop 1 and Crawl ghosts and its Overview "Add to crawl" left with
// them, because the card's one door owns all three. Nothing on it appears
// twice on the sheet.
//
// ONE CORAL. The plan door is the sheet's one painted control; "Ask for a
// table" and Share are ghosts, and the Overview's price door is drawn in ink.

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Share2, Users } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import { ContributionGateDialog } from "@/components/identity/ContributionGateDialog";
import { useSheetFooterSlot } from "@/components/mobile/sheetFooterContext";
import type { ContributionGateStatus } from "@/lib/contributionGateStatus";
import { TABLE_REQUEST_ACTION_LABEL } from "@/lib/tableRequests";
import type { ShareFeedback } from "@/lib/venueShare";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

import "./venueActionCard.css";

// The form is its own chunk: most sheets never open it.
const TableRequestDialog = dynamic(() => import("./TableRequestDialog"), { ssr: false });

export default function VenueActionCard({
  venue,
  summary,
  shareVenue,
  currentShareFeedback,
  acceptanceError = null,
}: {
  venue: Venue;
  /** The price, the walk and the plan door, read by the map (VenueActionSummary). */
  summary?: ReactNode;
  shareVenue: () => Promise<void>;
  currentShareFeedback: ShareFeedback | null;
  acceptanceError?: string | null;
}) {
  const footerSlot = useSheetFooterSlot();
  const { configured, loading, user, handle } = useAuth();
  const pub = isPubVenue(venue);
  // Kept by venue id, so selecting another pub never carries a half-typed
  // request or an open gate across.
  const [tableVenueId, setTableVenueId] = useState<string | null>(null);
  const [gate, setGate] = useState<{ venueId: string; status: ContributionGateStatus } | null>(null);
  const tableOpen = tableVenueId === venue.id;
  const gateStatus = gate?.venueId === venue.id ? gate.status : null;

  // Signed in with a handle, or a deployment with no sign-in at all (where the
  // form can only ever hand back the pub's own address). The age question is
  // the server's to ask, and the form answers it with the same gate. A session
  // still resolving opens the form too: the route gates the send.
  function askForTable(): void {
    if (configured && !loading && !user) {
      setGate({ venueId: venue.id, status: "sign_in_required" });
      return;
    }
    if (configured && !loading && user && !handle) {
      setGate({ venueId: venue.id, status: "onboarding_required" });
      return;
    }
    setTableVenueId(venue.id);
  }

  const card = (
    <div
      className="venueActionCard"
      data-venue-action-card=""
      role="group"
      aria-label={`${venue.name}, price and actions`}
    >
      {summary}
      <div className="venueSheetStickyBar venueActionCardActions" role="toolbar" aria-label="Venue actions">
        {pub ? (
          <button
            type="button"
            className="venueSheetStickyGhost"
            aria-haspopup="dialog"
            aria-label={`Ask ${venue.name} for a table`}
            onClick={askForTable}
          >
            <Users size={16} aria-hidden="true" />
            {TABLE_REQUEST_ACTION_LABEL}
          </button>
        ) : null}
        <button
          type="button"
          className="venueSheetStickyGhost"
          onClick={() => {
            void shareVenue();
          }}
          aria-label={`Share ${venue.name}`}
        >
          <Share2 size={16} aria-hidden="true" />
          Share
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
        <TableRequestDialog key={venue.id} venue={venue} onClose={() => setTableVenueId(null)} />
      ) : null}
      {gateStatus ? (
        <ContributionGateDialog mode={gateStatus} error={null} onClose={() => setGate(null)} />
      ) : null}
    </div>
  );

  return footerSlot ? createPortal(card, footerSlot) : card;
}
