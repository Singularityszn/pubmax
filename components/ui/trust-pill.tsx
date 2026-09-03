import { trustPillLabel, type TrustPillTone } from "@/lib/trustPill";

import "./trustPill.css";

/**
 * How far to trust the price beside it.
 *
 * Green: a drinker confirmed this price inside the 30 day window. Grey: nobody
 * has. Amber: a scraped price, styled here and passed by nothing until London
 * is re-collected (#1329). The words come from lib/trustPill.ts so the pill,
 * the venue sheet and a share card say the same thing.
 *
 * The meaning rides in the text, never in the colour alone: the confirmed pill
 * prints its day, the grey pill says no price is logged. The dot is
 * decorative and hidden from assistive technology.
 */
export default function TrustPill({
  tone,
  confirmedAt,
  className,
}: {
  tone: TrustPillTone;
  /** Epoch ms of the confirmation the pill reports. Printed on the confirmed tone. */
  confirmedAt?: number | null;
  className?: string;
}) {
  const classes = ["trustPill", `trustPill-${tone}`, className].filter(Boolean).join(" ");
  return (
    <span className={classes} data-tone={tone}>
      <span className="trustPillDot" aria-hidden="true" />
      {trustPillLabel(tone, confirmedAt)}
    </span>
  );
}
