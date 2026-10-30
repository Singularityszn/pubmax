"use client";

// "That's wrong": the quiet door beside the price door and under the opening
// hours on a pub's sheet. It is NOT a price door: it wears no `priceDoor`
// class and no `data-price-door`, so the one-price-door-per-trust-state rule
// still counts one door. It opens a tiny inline form whose answer goes to a
// person (/api/venue-corrections); nothing on the map moves when it is sent.
//
// "Price has changed" is offered here too, but it opens the existing log flow
// (the price door's own action), because a new price is a dated observation
// with a bill behind it, not a complaint.

import { useId, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SignInButton from "@/components/auth/SignInButton";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  VENUE_CORRECTION_CHOICES,
  VENUE_CORRECTION_NOTE_MAX,
  VENUE_CORRECTION_RECEIPT,
  type VenueCorrectionKind,
} from "@/lib/venueCorrections";

import "./venueCorrectionDoor.css";

const SIGN_IN_LINE = "Sign in to contribute.";
const FAILED = "Couldn't send that. Try again.";

type Phase = "closed" | "open" | "sending" | "sent";

export default function VenueCorrectionDoor({
  venueId,
  venueName,
  onLogPrice,
  offerPrice = true,
  where,
}: {
  venueId: string;
  venueName: string;
  /** The price door's log action. Absent where no price can be logged, and then the price choice is not offered. */
  onLogPrice?: () => void;
  /** False where the venue takes no price (not a pub), so the price choice is not offered. */
  offerPrice?: boolean;
  /** Which line the door sits on, for its accessible name and test hooks. */
  where: "price" | "details";
}): React.JSX.Element {
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>("closed");
  const [kind, setKind] = useState<VenueCorrectionKind | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const formId = useId();
  const choices = VENUE_CORRECTION_CHOICES.filter((choice) => choice.kind !== "price" || (offerPrice && onLogPrice));

  function close() {
    setPhase("closed");
    setKind(null);
    setNote("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind || phase === "sending") return;
    if (kind === "price") {
      close();
      onLogPrice?.();
      return;
    }
    setPhase("sending");
    setError("");
    try {
      const response = await authedActionFetch(
        "/api/venue-corrections",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ venueId, kind, note: note.trim() || undefined }),
        },
        { requiresIdentity: true },
      );
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(offlineOrMessage(errorMessageFrom(body, FAILED)));
        setPhase("open");
        return;
      }
      setPhase("sent");
    } catch {
      setError(offlineOrMessage(FAILED));
      setPhase("open");
    }
  }

  if (phase === "closed") {
    return (
      <button
        type="button"
        className="venueCorrectionDoor"
        data-venue-correction={where}
        aria-expanded="false"
        aria-label={`That's wrong: tell us about ${venueName}`}
        onClick={() => setPhase("open")}
      >
        That&rsquo;s wrong
      </button>
    );
  }

  if (phase === "sent") {
    return (
      <p className="venueCorrectionReceipt" role="status" data-venue-correction={where}>
        {VENUE_CORRECTION_RECEIPT}
      </p>
    );
  }

  if (!user) {
    return (
      <div className="venueCorrectionForm" data-venue-correction={where}>
        <p className="venueCorrectionLine">{loading ? "Checking your account." : SIGN_IN_LINE}</p>
        {loading ? null : <SignInButton />}
        <button type="button" className="venueCorrectionCancel" onClick={close}>
          Not now
        </button>
      </div>
    );
  }

  return (
    <form
      className="venueCorrectionForm"
      data-venue-correction={where}
      aria-labelledby={`${formId}-legend`}
      onSubmit={(event) => void submit(event)}
    >
      <fieldset className="venueCorrectionChoices" disabled={phase === "sending"}>
        <legend id={`${formId}-legend`}>What&rsquo;s wrong at {venueName}?</legend>
        {choices.map((choice) => (
          <label key={choice.kind} className="venueCorrectionChoice">
            <input
              type="radio"
              name={`${formId}-kind`}
              value={choice.kind}
              checked={kind === choice.kind}
              onChange={() => setKind(choice.kind)}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      {kind && kind !== "price" ? (
        <label className="venueCorrectionNote">
          A line for the person checking (optional)
          <input
            type="text"
            value={note}
            maxLength={VENUE_CORRECTION_NOTE_MAX}
            disabled={phase === "sending"}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      ) : null}
      {error ? (
        <p className="venueCorrectionLine" role="alert">
          {error}
        </p>
      ) : null}
      <div className="venueCorrectionActions">
        <button type="submit" className="venueCorrectionSend" disabled={!kind || phase === "sending"}>
          {kind === "price" ? "Log the new price" : phase === "sending" ? "Sending…" : "Send"}
        </button>
        <button type="button" className="venueCorrectionCancel" onClick={close}>
          Not now
        </button>
      </div>
    </form>
  );
}
