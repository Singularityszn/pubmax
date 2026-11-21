"use client";

import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";

import "./mapPhoneVenueSheet.css";

export default function MapPhoneVenueSheet({ open, status, onClose, backLabel, onBack, onHome, homeTitle, children }: {
  open: boolean;
  status: string;
  onClose: () => void;
  backLabel: string | null;
  onBack?: () => void;
  onHome?: () => void;
  homeTitle: string;
  children: ReactNode;
}) {
  return (
    <Sheet
      kind={open ? "venue-list" : null}
      title="Pubs in this view"
      initialSnap="half"
      closeLabel="Close pub list"
      onClose={onHome ?? onClose}
      onDismiss={onClose}
      backLabel={backLabel}
      onBack={onBack}
      homeTitle={homeTitle}
    >
      <div className="mapPhoneVenueList">
        <p className="mapPhoneVenueListStatus" role="status">{status}</p>
        <p className="mapPhoneVenueListNote">Distances from the map centre.</p>
        {children}
      </div>
    </Sheet>
  );
}
