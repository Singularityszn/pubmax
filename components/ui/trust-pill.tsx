import {
  HOW_WE_ESTIMATE_HREF,
  HOW_WE_ESTIMATE_LABEL,
  priceStandingFigure,
  priceStandingNote,
  type PriceStandingDecision,
} from "@/lib/priceTier";
import { priceBand, priceBandClass, type PriceBandArea } from "@/lib/priceBand";
import { confirmedAtMsOf, trustPillLabel } from "@/lib/trustPill";

import "./trustPill.css";

/**
 * How far to trust the price beside it, in WORDS, and what it costs, in
 * COLOUR. A PURE RENDERER over one decided standing: it takes the decision
 * `lib/priceTier.ts` made and never re-decides anything, which is what stops a
 * second opinion about a price existing.
 *
 * The word is the standing: "Confirmed 3 Sept", "Listed", "Estimated", "No
 * price yet". The colour is the price BAND of the figure (lib/priceBand.ts):
 * red expensive, yellow average, green cheap, and neutral ink when there is no
 * figure to band. The pill used to wear a tone per standing instead, and a
 * reader saw a green "Confirmed" over a dear pint (captain's law 2026-09-05).
 *
 * The figure is never formatted here. `priceStandingFigure` is the one place a
 * standing becomes a string, so a modelled price cannot lose its "est." on the
 * way to a screen. A modelled figure still owes its method, and that link is a
 * sibling of the pill.
 *
 * The meaning rides in the text, never in the colour alone. The dot is
 * decorative and hidden from assistive technology.
 */
export default function TrustPill({
  decision,
  /** One line naming the basis and its sample. Estimates only; see estimateBasisNote. */
  basisNote,
  /** Where the figure is read, for the band's thresholds. Absent means the dataset. */
  area,
  className,
}: {
  decision: PriceStandingDecision;
  basisNote?: string | null;
  area?: PriceBandArea;
  className?: string;
}) {
  const { standing } = decision;
  const figure = priceStandingFigure(decision);
  const band = figure ? priceBand(decision.priceGbp, area) : null;
  const isEstimate = standing === "estimate";
  const classes = ["trustPill", priceBandClass(band), className].filter(Boolean).join(" ");

  const pill = (
    <span
      className={classes}
      data-standing={standing}
      data-price-band={band ?? undefined}
      title={priceStandingNote(standing)}
    >
      <span className="trustPillDot" aria-hidden="true" />
      {figure ? <span className="trustPillFigure">{figure}</span> : null}
      {trustPillLabel(standing, confirmedAtMsOf(decision))}
    </span>
  );

  // A published or confirmed price is the whole claim, so the pill stands alone.
  // A modelled one owes its method, and that link is a SIBLING of the pill
  // rather than inside it, because a link wrapping a figure reads as though the
  // figure itself were the link.
  if (!isEstimate) return pill;

  return (
    <span className="trustPillRow">
      {pill}
      <a className="trustPillMethodLink" href={HOW_WE_ESTIMATE_HREF}>
        {HOW_WE_ESTIMATE_LABEL}
      </a>
      {basisNote ? <span className="trustPillBasis">{basisNote}</span> : null}
    </span>
  );
}
