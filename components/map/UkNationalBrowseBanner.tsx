"use client";

import { MapPin, X } from "lucide-react";
import { useState } from "react";

import { UK_NATIONAL_BROWSE_COPY } from "@/lib/ukNationalBrowse";

import "./ukPlaceArrivalBanner.css";

export default function UkNationalBrowseBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <aside
      className="ukPlaceArrival"
      aria-label={UK_NATIONAL_BROWSE_COPY.title}
    >
      <MapPin className="ukPlaceArrivalIcon" size={18} aria-hidden="true" />
      <span className="ukPlaceArrivalCopy">
        <strong>{UK_NATIONAL_BROWSE_COPY.title}</strong>
        <span>{UK_NATIONAL_BROWSE_COPY.body}</span>
      </span>
      <button
        type="button"
        className="ukPlaceArrivalDismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss UK pub map note"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
