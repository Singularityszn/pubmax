"use client";

// Keep and its failure travel together. The acceptance failure belongs to one
// row, so it renders beside that row's own Keep button and never as a single
// page-level alert above the whole list.

import {
  tonightRowAcceptanceError,
  type TonightAcceptanceError,
} from "@/lib/tonightAcceptance";

export function TonightRowAccept({
  venueId,
  placeName,
  className,
  label,
  acceptanceError,
  onAccept,
}: {
  venueId: string;
  placeName: string;
  className: string;
  label: string;
  acceptanceError: TonightAcceptanceError | null;
  onAccept: (venueId: string) => void;
}) {
  const message = tonightRowAcceptanceError(acceptanceError, venueId);
  return (
    <>
      <button
        type="button"
        className={`${className} pressable`}
        aria-label={`Keep ${placeName} for tonight`}
        onClick={() => onAccept(venueId)}
      >
        {label}
      </button>
      {message ? (
        <p className="tonightAcceptanceError" role="alert">{message}</p>
      ) : null}
    </>
  );
}

export default TonightRowAccept;
