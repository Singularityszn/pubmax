import type { ReactNode } from "react";

import type { PintReceipt } from "@/lib/pintReceipt";

import "./pintReceipt.css";

// A Pint Drop printed as a till receipt (lib/pintReceipt.ts owns every word on
// it). `full` is the permalink's receipt. `stub` is the short tear-off the
// composer offers to share right after Log it. Labels are set in the UI sans
// and figures in the data face (docs/DESIGN_SYSTEM.md, "Monospace is for
// figures").

type Props = {
  receipt: PintReceipt;
  variant?: "full" | "stub";
  /** Printed between the header and the line items: the drinker's photo. */
  media?: ReactNode;
  /** Printed after the totals: the drinker's note and tags. */
  extras?: ReactNode;
  className?: string;
};

export default function PintReceiptPaper({
  receipt,
  variant = "full",
  media,
  extras,
  className,
}: Props) {
  const full = variant === "full";
  return (
    <article
      className={`pintReceipt pintReceipt--${variant}${className ? ` ${className}` : ""}`}
      aria-label={`Pint receipt from ${receipt.venueName}`}
    >
      <header className="pintReceipt__head">
        {full ? <p className="pintReceipt__brand">PUBMAXX</p> : null}
        <p className="pintReceipt__kind">Pint receipt</p>
        {full ? (
          <h1 className="pintReceipt__venue">{receipt.venueName}</h1>
        ) : (
          <p className="pintReceipt__venue">{receipt.venueName}</p>
        )}
        {receipt.loggedOn ? (
          <p className="pintReceipt__row pintReceipt__row--center">
            <span>Logged</span>
            <time className="pintReceipt__figure">{receipt.loggedOn}</time>
          </p>
        ) : null}
      </header>

      {media ? <div className="pintReceipt__media">{media}</div> : null}

      <div className="pintReceipt__rule" aria-hidden="true" />

      <p className="pintReceipt__row pintReceipt__item">
        <span className="pintReceipt__itemName">
          <span>
            <span className="pintReceipt__figure">1</span> × {receipt.measure}
          </span>
          {receipt.drink ? <span className="pintReceipt__drink">{receipt.drink}</span> : null}
        </span>
        {receipt.price ? <span className="pintReceipt__figure">{receipt.price}</span> : null}
      </p>

      <div className="pintReceipt__rule" aria-hidden="true" />

      {receipt.price ? (
        <p className="pintReceipt__row pintReceipt__total">
          <span>Paid</span>
          <span className="pintReceipt__figure pintReceipt__totalFigure">{receipt.price}</span>
        </p>
      ) : (
        <p className="pintReceipt__none">No price on this one. Just the pint.</p>
      )}

      <dl className="pintReceipt__facts">
        <div className="pintReceipt__row">
          <dt>Drinker</dt>
          <dd>{receipt.drinker}</dd>
        </div>
        {receipt.bill ? (
          <div className="pintReceipt__row">
            <dt>Price</dt>
            <dd>{receipt.bill}</dd>
          </div>
        ) : null}
      </dl>

      {extras ? (
        <>
          <div className="pintReceipt__rule" aria-hidden="true" />
          <div className="pintReceipt__extras">{extras}</div>
        </>
      ) : null}

      {full ? (
        <footer className="pintReceipt__foot">
          <p>Logged by a drinker, not by the pub.</p>
          <p>Cheers. pubmaxxing.com</p>
        </footer>
      ) : null}
    </article>
  );
}
