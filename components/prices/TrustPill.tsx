// The one surface that says what a pub's pint price is worth.
//
// It renders the STANDING and the figure together, and it never formats the
// figure itself: `priceStandingFigure` owns that, so a modelled price cannot
// lose its "est." on the way to a screen. An estimate also carries its method
// link, because a number nobody published owes the reader a way to check how it
// was reached.
//
// It renders for `none` too. "No price yet" is a real answer and it is the one
// that points a drinker at the pubs still missing a price, which is the whole
// point of showing the standing rather than hiding the weak ones.

import {
  HOW_WE_ESTIMATE_HREF,
  HOW_WE_ESTIMATE_LABEL,
  priceStandingFigure,
  priceStandingLabel,
  priceStandingNote,
  type PriceStandingDecision,
} from "@/lib/priceTier";
import "./trustPill.css";

const TONE_CLASS: Record<PriceStandingDecision["standing"], string> = {
  confirmed: "trustPillConfirmed",
  listed: "trustPillListed",
  estimate: "trustPillEstimate",
  none: "trustPillNone",
};

export default function TrustPill({
  decision,
  /** One line naming the basis and its sample. Estimates only; see estimateBasisNote. */
  basisNote = null,
}: {
  decision: PriceStandingDecision;
  basisNote?: string | null;
}): React.JSX.Element {
  const figure = priceStandingFigure(decision);
  const word = priceStandingLabel(decision.standing);
  const isEstimate = decision.standing === "estimate";

  return (
    <span className="trustPillRow">
      <span
        className={`trustPill ${TONE_CLASS[decision.standing]}`}
        title={priceStandingNote(decision.standing)}
      >
        {figure ? <span className="trustPillFigure">{figure}</span> : null}
        <span className="trustPillWord">{word}</span>
      </span>
      {isEstimate ? (
        <a className="trustPillMethodLink" href={HOW_WE_ESTIMATE_HREF}>
          {HOW_WE_ESTIMATE_LABEL}
        </a>
      ) : null}
      {isEstimate && basisNote ? <span className="trustPillBasis">{basisNote}</span> : null}
    </span>
  );
}
