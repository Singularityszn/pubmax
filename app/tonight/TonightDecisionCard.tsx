import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  LocateFixed,
  Route,
} from "lucide-react";

import {
  buildTonightDecisionModel,
  type TonightDecisionListingState,
} from "@/lib/tonightDecision";

const ICONS = {
  "one-pub": LocateFixed,
  "three-stop": Route,
  "whats-on": CalendarClock,
} as const;

export default function TonightDecisionCard({
  listingState,
  listingCount,
  nearContext,
}: {
  listingState: TonightDecisionListingState;
  listingCount: number;
  nearContext?: { patchLabel?: string | null } | null;
}) {
  const model = buildTonightDecisionModel({
    listingState,
    listingCount,
    areaLabel: nearContext?.patchLabel,
  });

  return (
    <section className="tonightDecision" aria-labelledby="tonight-decision-title">
      <div className="tonightDecisionHead">
        <div>
          <p className="tonightDecisionEyebrow">Your night, in one tap</p>
          <h2 id="tonight-decision-title">Choose the shape.</h2>
        </div>
        <p className="tonightDecisionProof" aria-live="polite">
          <span aria-hidden="true" />
          {model.proof}
        </p>
      </div>

      <div className="tonightDecisionGrid">
        {model.options.map((option, index) => {
          const Icon = ICONS[option.id];
          const contents = (
            <>
              <span className="tonightDecisionNumber" aria-hidden="true">
                0{index + 1}
              </span>
              <span className="tonightDecisionIcon" aria-hidden="true">
                <Icon size={19} strokeWidth={1.8} />
              </span>
              <span className="tonightDecisionCopy">
                <strong>{option.title}</strong>
                <small>{option.detail}</small>
              </span>
              <ArrowUpRight
                className="tonightDecisionArrow"
                size={17}
                aria-hidden="true"
              />
            </>
          );

          return option.href.startsWith("#") ? (
            <a
              key={option.id}
              className="tonightDecisionOption pressable"
              data-intent={option.id}
              href={option.href}
            >
              {contents}
            </a>
          ) : (
            <Link
              key={option.id}
              className="tonightDecisionOption pressable"
              data-intent={option.id}
              href={option.href}
            >
              {contents}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
