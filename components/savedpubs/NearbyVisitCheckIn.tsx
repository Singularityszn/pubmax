"use client";

import { useEffect, useRef, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { emitBeenHereChanged } from "@/lib/beenHere";

export default function NearbyVisitCheckIn({ venueId, handle, disabled, onSaved }: {
  venueId: string;
  handle: string;
  disabled: boolean;
  onSaved(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function checkIn() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage("");
    try {
      if (!navigator.geolocation) throw new Error("This browser can't check your location. You can still save Been here.");
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
      });
      controller.signal.throwIfAborted();
      const response = await authedActionFetch("/api/saved-pubs", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, venueId, action: "nearbyCheckIn", location: {
          lat: position.coords.latitude, lng: position.coords.longitude,
          accuracy: position.coords.accuracy, timestamp: position.timestamp,
        } }),
      }, { requiresIdentity: true });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFrom(body, "Couldn't save that check-in. Try again."));
      controller.signal.throwIfAborted();
      onSaved();
      emitBeenHereChanged();
      setMessage("Nearby visit checked. Saved to Been here.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Couldn't check your location. You can still save Been here.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div>
    <p className="saveToListToast">Check in here using your location. We keep the pub and time, not your exact location.</p>
    <button type="button" className="saveToListChip" disabled={disabled || busy} onClick={() => void checkIn()}>
      {busy ? "Checking nearby…" : "Check in nearby"}
    </button>
    {message ? <p className="saveToListToast" role="status">{message}</p> : null}
  </div>;
}
