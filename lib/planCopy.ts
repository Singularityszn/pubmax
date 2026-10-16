// The words the planner prints, written down once so the /plan page, the
// phone map's planner sheet and the map's own door say the same thing.
//
// Plain beats clever here (UX audit P2-B, 16 Oct 2026): the planner builds a
// pub crawl, so it says so. "Describe the outing", "Sort it" and "Guide me
// instead" were retired for these.

/** The planner's heading, and the name of the map control that opens it. */
export const PLAN_HEADING = "Plan a pub crawl";

/** The accessible name of the free-text field every planner ask uses. */
export const PLAN_FIELD_LABEL = "Where, how many, what budget";

/** The one painted action on /plan's describe-first form. */
export const PLAN_SUBMIT_LABEL = "Plan it";

/** The same action once a route is already on the page. */
export const PLAN_RESUBMIT_LABEL = "Plan it again";

/** The quiet way into the step-by-step form instead of typing. */
export const PLAN_STEP_BY_STEP_LABEL = "Step by step";
