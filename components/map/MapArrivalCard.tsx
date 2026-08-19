"use client";

import { useEffect } from "react";
import { LocateFixed, X } from "lucide-react";

import {
  dismissMapFirstVisitArrival,
  setMapFirstVisitArrivalCardVisible,
} from "@/lib/mapFirstVisitArrival";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./mapArrivalCard.css";

export default function MapArrivalCard({
  onUseLocation,
  onChooseArea,
  onDismiss,
}: {
  onUseLocation: () => void;
  onChooseArea: () => void;
  onDismiss?: () => void;
}) {
  useEffect(() => {
    setMapFirstVisitArrivalCardVisible(true);
    return () => setMapFirstVisitArrivalCardVisible(false);
  }, []);

  const dismiss = () => {
    dismissMapFirstVisitArrival();
    onDismiss?.();
  };

  useDismissOnEscape(true, dismiss);

  return (
    <aside
      className="mapArrivalCard"
      aria-label="First visit"
      aria-live="polite"
    >
      <button
        type="button"
        className="mapArrivalCardClose"
        aria-label="Close"
        onClick={dismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
      <p className="mapArrivalCardEyebrow">First visit</p>
      <h2 className="mapArrivalCardTitle">Cheapest pints near you?</h2>
      <p className="mapArrivalCardLead">
        Location is used only while the map is open. Or pick an area.
      </p>
      <div className="mapArrivalCardActions">
        <button
          type="button"
          className="mapArrivalCardPrimary"
          onClick={() => {
            dismissMapFirstVisitArrival();
            onUseLocation();
          }}
        >
          <LocateFixed size={16} aria-hidden="true" /> Use my location
        </button>
        <button
          type="button"
          className="mapArrivalCardSecondary"
          onClick={() => {
            dismissMapFirstVisitArrival();
            onChooseArea();
          }}
        >
          Choose an area
        </button>
      </div>
    </aside>
  );
}
