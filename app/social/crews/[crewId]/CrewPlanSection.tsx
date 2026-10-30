import type { SocialCrewPageDTO } from "@/lib/socialCrew";
import { openCrawlPlacesLeft, openCrawlPlacesLine } from "@/lib/openCrawl";

/** The id the plan block carries, so "See the plan" lands on it. */
export const CREW_PLAN_ANCHOR = "plan";

// THE PLAN THE CREW CARRIES (launch review 4.5, E1). A crew is one night bound
// to one plan, and a member's read already holds that plan's stops in order;
// the crew page used to print none of it. A joiner the host accepts lands here,
// so this block is the plan's link for them: when it starts, where to meet,
// the host's line, how many places are left, and every stop in order.
//
// A social plan is not readable at /plan/[id] (the plan read there is for
// plans no crew holds), so the link is this block, never a /plan URL.
export default function CrewPlanSection({ crew }: { crew: SocialCrewPageDTO }) {
  const stops = crew.plan.stops.slice().sort((left, right) => left.position - right.position);
  const openCrawl = crew.openCrawl ?? null;
  const placesLeft = openCrawl
    ? openCrawlPlacesLeft({ capacity: openCrawl.capacity, memberCount: crew.members.length })
    : null;
  if (!stops.length && !openCrawl) return null;
  return (
    <section id={CREW_PLAN_ANCHOR} aria-labelledby="crew-plan-title" className="crewPlan" data-testid="crew-plan">
      <h2 id="crew-plan-title" className="crews__title">
        The plan
      </h2>
      {openCrawl ? (
        <>
          <p className="crewPlan__line">{openCrawl.description}</p>
          <p className="crews__muted">
            Meet at {openCrawl.meetingVenueName}.{" "}
            {placesLeft !== null ? `${openCrawlPlacesLine(placesLeft)} of ${openCrawl.capacity}.` : null}
          </p>
        </>
      ) : null}
      {stops.length ? (
        <ol className="crewPlan__stops" aria-label="Stops in order">
          {stops.map((stop, index) => (
            <li key={`${stop.venueId}-${stop.position}`} className="crewPlan__stop">
              <span className="crewPlan__number" aria-hidden="true">{index + 1}</span>
              <span>{stop.venueName}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
