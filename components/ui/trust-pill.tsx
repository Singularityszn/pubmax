import {
  HOW_WE_ESTIMATE_HREF,
  HOW_WE_ESTIMATE_LABEL,
  PRICE_STANDING_TONE,
  priceStandingFigure,
  priceStandingNote,
  type PriceStandingDecision,
} from "@/lib/priceTier";
import { confirmedAtMsOf, trustPillLabel } from "@/lib/trustPill";

import "./trustPill.css";

/**
 * How far to trust the price beside it. A PURE RENDERER over one decided
 * standing: it takes the decision `lib/priceTier.ts` made and never re-decides
 * anything, which is what stops a second opinion about a price existing.
 *
 * Green: a drinker confirmed this price inside the 30 day window, and it prints
 * the day. Amber: the pub or its chain published it. Blue: we MODELLED it, so
 * it prints `est. £X` and offers the method, because a figure nobody published
 * owes the reader a way to check how it was reached. Grey: nobody has logged
 * one.
 *
 * The figure is never formatted here. `priceStandingFigure` is the one place a
 * standing becomes a string, so a modelled price cannot lose its "est." on the
 * way to a screen.
 *
 * The meaning rides in the text, never in the colour alone. The dot is
 * decorative and hidden from assistive technology.
 */
export default function TrustPill({
  decision,
  /** One line naming the basis and its sample. Estimates only; see estimateBasisNote. */
  basisNote,
  className,
}: {
  decision: PriceStandingDecision;
  basisNote?: string | null;
  className?: string;
}) {
  const { standing } = decision;
  const tone = PRICE_STANDING_TONE[standing];
  const figure = priceStandingFigure(decision);
  const isEstimate = standing === "estimate";
  const classes = ["trustPill", `trustPill-${tone}`, className].filter(Boolean).join(" ");

  const pill = (
    <span className={classes} data-standing={standing} data-tone={tone} title={priceStandingNote(standing)}>
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
