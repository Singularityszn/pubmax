"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import MessageVenuePicker, { type PickedVenue } from "./MessageVenuePicker";
import "./optionalVenueField.css";

export default function OptionalVenueField({ venueId, venueName, disabled = false, onChange }: {
  venueId: string;
  venueName?: string;
  disabled?: boolean;
  onChange: (venue: PickedVenue | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  return <div className="optionalVenueField" onKeyDown={(event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "search") event.preventDefault();
  }}>
    <span className="optionalVenueFieldLabel">Pub <small>optional</small></span>
    {venueId ? <p className="optionalVenueFieldName">{venueName || "Choose this pub again before saving"}</p> : null}
    {picking && !disabled ? <MessageVenuePicker onPick={(venue) => { onChange(venue); setPicking(false); }} onCancel={() => setPicking(false)} /> : <div className="optionalVenueFieldActions">
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => setPicking(true)}>{venueId ? "Change pub" : "Choose a pub"}</Button>
      {venueId ? <Button type="button" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>Remove pub</Button> : null}
    </div>}
  </div>;
}
