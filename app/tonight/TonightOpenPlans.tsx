import type { Route } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { outOpenPlansSectionVisible, sendableOpenPlans } from "@/lib/outDesktopGrouping";
import { OUT_OPEN_PLANS_WAY_LABEL } from "@/lib/outListings";
import type { OutOpenPlan } from "@/lib/out";
import type { OutResponse } from "@/lib/out/types";
import { crewPath } from "@/lib/socialCrewsUi";

import "./tonightLater.css";
import "@/components/tonight/tonightAnswers.css";

/** The line a degraded open-plans read prints in place of the plans. */
export const TONIGHT_OPEN_PLANS_UNREAD_LINE = "We couldn’t check open plans just now.";

/** The one action on an open plan card. The host still says yes or no. */
export const TONIGHT_OPEN_PLAN_ASK_LABEL = "Ask to join";

const PLAN_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function planWhen(startTime: string): string | null {
  const ms = Date.parse(startTime);
  return Number.isFinite(ms) ? PLAN_TIME.format(new Date(ms)) : null;
}

// One card: the host's handle, the time, the meeting pub and the one action.
// The meeting pub is the plan's own meeting point, else its first stop; a
// sendable plan always carries one (lib/outDesktopGrouping.ts).
function TonightOpenPlanCard({ plan }: { plan: OutOpenPlan }) {
  const when = planWhen(plan.startTime);
  const meet = plan.meetingPoint?.name ?? plan.stopVenueName ?? null;
  return (
    <li className="outOpenPlanCard tonightPlanCard" data-testid="tonight-open-plan">
      <h3 className="tonightPlanCardTitle">{plan.title}</h3>
      <p className="tonightAnswerMeta">
        {`@${plan.hostHandle}`}
        {when ? ` · ${when}` : ""}
      </p>
      {meet ? <p className="tonightAnswerMeta">{`Meet at ${meet}`}</p> : null}
      <Link prefetch={false} className="tonightPlanCardAsk" href={crewPath(plan.crewId) as Route}>
        {TONIGHT_OPEN_PLAN_ASK_LABEL}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </li>
  );
}

/**
 * Open plans tonight, above the recommended pubs (design V2, 30 Oct 2026).
 *
 * The plans ride the /api/out answer /tonight already reads for its listings,
 * so they cost no request of their own. A plan section with no sendable plan,
 * or one still in preview, renders nothing: an empty card is not a section. A
 * read that failed is one line.
 */
export default function TonightOpenPlans({ body }: { body: OutResponse | null }) {
  const status = body?.openPlansStatus;
  const plans = body?.openPlans ?? [];
  const showPlans =
    status !== "preview" && status !== "degraded" && outOpenPlansSectionVisible(plans);

  if (showPlans) {
    return (
      <section
        className="tonightOpenPlans tonightOpenPlansAbove"
        aria-labelledby="tonight-open-plans-heading"
        data-testid="tonight-open-plans"
      >
        <h2 id="tonight-open-plans-heading" className="outSectionTitle">
          Open plans
        </h2>
        <ul className="outOpenPlanList">
          {sendableOpenPlans(plans).map((plan) => (
            <TonightOpenPlanCard key={plan.crewId} plan={plan} />
          ))}
        </ul>
        <p className="outPlansFoot">
          <Link prefetch={false} href="/plan" className="outPlansFootLink">
            {OUT_OPEN_PLANS_WAY_LABEL}
          </Link>
        </p>
      </section>
    );
  }
  if (status === "degraded") {
    return (
      <p className="outStatus tonightOpenPlans" role="status" data-testid="tonight-open-plans-unread">
        {TONIGHT_OPEN_PLANS_UNREAD_LINE}
      </p>
    );
  }
  return null;
}

/**
 * The Drink Wall line, carried over from /out. Always there, because it is a
 * door, not a reading, and it stays in the rail where it was.
 */
export function TonightDrinkWallLine() {
  return (
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
  );
}
