// The two non-event doors under a picks section with nothing in it.
//
// ONE renderer, shared by /today's picks card and /tonight's listing spine, so
// a reader who meets an empty night on either surface meets the same offer in
// the same words. Presentation only: which state earned it, what it is
// labelled and where each door points are all decided in lib/picksState.ts
// before they reach here.
//
// It is a labelled ROW of quiet links and never a card of its own. A card
// inside a card is one of the shapes docs/VOICE.md "Template patterns" bans,
// and the sections this sits in already carry their edge.

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import "./picksAlternatives.css";

import {
  PICKS_ALTERNATIVE_LABEL,
  picksAlternativeWays,
  type PicksContext,
} from "@/lib/picksState";

export default function PicksAlternatives({
  context,
  className,
}: {
  /** The area and occasion the reader already chose, carried into both doors. */
  context?: PicksContext;
  className?: string;
}) {
  const ways = picksAlternativeWays(context ?? {});
  return (
    <div
      className={className ? `picksAlternatives ${className}` : "picksAlternatives"}
      data-testid="picks-alternatives"
    >
      <p className="picksAlternativesLabel">{PICKS_ALTERNATIVE_LABEL}</p>
      <ul className="picksAlternativesList">
        {ways.map((way) => (
          <li key={way.key}>
            <Link
              prefetch={false}
              href={way.href}
              className="picksAlternativesLink pressable"
              data-picks-way={way.key}
            >
              <span>{way.label}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
