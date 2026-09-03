import { outRowSourceCredit } from "@/lib/out/attribution";
import type { WhatsOnSource } from "@/lib/whatsOn";

type SourceCreditProps = {
  source: WhatsOnSource;
};

/**
 * The credit beside a listing: the source's own NAME, linking to that source's
 * own page for this event.
 *
 * There is deliberately no mark here. Skiddle's credit is a licence obligation
 * that names a logo, and we do not hold Skiddle's asset - so the answer is to
 * ship no mark at all rather than a hand-drawn lookalike, which discharges
 * nothing and imitates another company's wordmark. The obligation stays
 * recorded (`logoRequired` is still true for Skiddle) and the lane it attaches
 * to is fenced off until the real asset lands: see SKIDDLE_BRAND_ASSET_PRESENT
 * in lib/whatson/eventNormalise.mjs, which both supply lanes read.
 *
 * The words and the destination come from ONE owner, `outRowSourceCredit`, so a
 * row's internal label ("common") is never the thing a reader sees, and the
 * name can never promise a place the link does not go. Two rules ride with it.
 *
 * The name tells the reader where the tap LANDS. Ticketmaster's own feed hands
 * us white-label partner links (universe.com) beside its own, and a credit
 * reading only "Ticketmaster" over one of those named the wrong place at the
 * exact point the claim was made, so the destination is named beside the
 * publisher whenever the two differ.
 *
 * A credit with no event page to open is TEXT, not a link. A publisher's front
 * door is a real link, which is what makes it the dishonest answer: beside a
 * listing it reads as "this event, at the source". The name still prints,
 * because the attribution is owed either way.
 */
export function SourceCredit({ source }: SourceCreditProps) {
  const credit = outRowSourceCredit(source);
  if (!credit.href) {
    return (
      <p className="outSourceCredit outSourceCredit--unlinked">
        <span>{credit.label}</span>
      </p>
    );
  }
  return (
    <a className="outSourceCredit" href={credit.href} rel="noopener noreferrer" target="_blank">
      <span>{credit.label}</span>
    </a>
  );
}
