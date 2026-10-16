import Link from "next/link";

import { OutOpenPlanCard } from "@/components/out/OutOpenPlanCard";
import { outOpenPlansSectionVisible, sendableOpenPlans } from "@/lib/outDesktopGrouping";
import { OUT_OPEN_PLANS_WAY_LABEL } from "@/lib/outListings";
import type { OutResponse } from "@/lib/out/types";

import "./tonightLater.css";

/** The line a degraded open-plans read prints in place of the plans. */
export const TONIGHT_OPEN_PLANS_UNREAD_LINE = "We couldn’t check open plans just now.";

/**
 * Open plans tonight, and the Drink Wall, carried over from /out.
 *
 * Both ride the /api/out answer /tonight already reads for its listings, so
 * neither costs a request of its own. A plan section with no sendable plan,
 * or one still in preview, renders nothing: an empty card is not a section.
 * A read that failed is one line. The Drink Wall line is always there,
 * because it is a door, not a reading.
 */
export default function TonightOpenPlans({ body }: { body: OutResponse | null }) {
  const status = body?.openPlansStatus;
  const plans = body?.openPlans ?? [];
  const showPlans =
    status !== "preview" && status !== "degraded" && outOpenPlansSectionVisible(plans);

  return (
    <>
      {showPlans ? (
        <section
          className="tonightOpenPlans"
          aria-labelledby="tonight-open-plans-heading"
          data-testid="tonight-open-plans"
        >
          <h2 id="tonight-open-plans-heading" className="outSectionTitle">
            Open plans
          </h2>
          <ul className="outOpenPlanList">
            {sendableOpenPlans(plans).map((plan) => (
              <OutOpenPlanCard key={plan.crewId} plan={plan} />
            ))}
          </ul>
          <p className="outPlansFoot">
            <Link prefetch={false} href="/plan" className="outPlansFootLink">
              {OUT_OPEN_PLANS_WAY_LABEL}
            </Link>
          </p>
        </section>
      ) : status === "degraded" ? (
        <p className="outStatus tonightOpenPlans" role="status" data-testid="tonight-open-plans-unread">
          {TONIGHT_OPEN_PLANS_UNREAD_LINE}
        </p>
      ) : null}
      <section
        className="tonightWallLine"
        aria-labelledby="tonight-wall-heading"
        data-testid="tonight-drink-wall"
      >
        <h2 id="tonight-wall-heading" className="outSectionTitle">
          Photos from drinkers
        </h2>
        <p className="outStatus">
          Pints, pub fronts and London views.{" "}
          <Link prefetch={false} href="/wall" className="outPlansFootLink">
            See the photos
          </Link>
        </p>
      </section>
    </>
  );
}
