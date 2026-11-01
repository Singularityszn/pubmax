import type { Route } from "next";
import Link from "next/link";

import IntentLink from "@/components/nav/IntentLink";
import { RowList } from "@/components/ui/row-list";

import {
  CULTURE_CRAWL_CHIPS,
  CULTURE_CRAWL_MISSION,
} from "@/lib/cultureCrawl";
import {
  planOccasionHref,
  TONIGHT_SOFT_PLAN_CHIPS,
} from "@/lib/planOccasion";

type Props = {
  /** Heritage quiet-pint module is on the page below — link scrolls to it. */
  hasQuietPint?: boolean;
};

/**
 * Compact soft-plan handoff on /tonight during a quiet typical-pattern hour.
 * Plan links only; no invented listings.
 *
 * Two short lists in the shared RowList shape (components/ui/row-list.tsx),
 * not a stack of boxed rows each wearing an icon disc and a chevron (taste
 * plan, 18 Oct 2026). Each row is one link and the whole row is its target.
 * The rows are written out rather than through `RowListItem` because a plan
 * door is an IntentLink: warmed on intent, never prefetched on sight.
 */
export default function TonightSoftPlansModule({ hasQuietPint = false }: Props) {
  return (
    <section
      className="tonightSoftPlans tonightSection"
      aria-labelledby="tonight-soft-plans-title"
      data-testid="tonight-soft-plans"
    >
      <h2 className="tonightSoftPlansEyebrow tonightSectionTitle" id="tonight-soft-plans-title">
        Ideas for tonight
      </h2>
      <RowList className="tonightSoftPlansList">
        {TONIGHT_SOFT_PLAN_CHIPS.map((chip) => (
          <PlanRow
            key={chip.id}
            href={planOccasionHref(chip.id, { src: "tonight-soft" })}
            label={chip.label}
          />
        ))}
        {hasQuietPint ? (
          <li className="rowListItem rowListItem--link tonightSoftPlansRow">
            <span className="rowListBody">
              <Link href="#tonight-quiet-pint" className="rowListTitle rowListTitleLink">
                A quiet pint
              </Link>
            </span>
          </li>
        ) : null}
      </RowList>
      <p className="tonightSoftPlansCultureEyebrow tonightSectionLine">
        {CULTURE_CRAWL_MISSION}
      </p>
      <RowList className="tonightSoftPlansList">
        {CULTURE_CRAWL_CHIPS.map((chip) => (
          <PlanRow
            key={chip.id}
            href={planOccasionHref(chip.id, { src: "tonight-culture" })}
            label={chip.label}
          />
        ))}
      </RowList>
    </section>
  );
}

function PlanRow({ href, label }: { href: Route; label: string }) {
  return (
    <li className="rowListItem rowListItem--link tonightSoftPlansRow">
      <span className="rowListBody">
        <IntentLink href={href} className="rowListTitle rowListTitleLink">
          {label}
        </IntentLink>
      </span>
    </li>
  );
}
