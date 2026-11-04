/**
 * Whether a tube the reader named is their way HOME rather than a rule for the
 * route between stops. "Then home by tube" says how the night ends, so it is
 * no route rule and never removes a pub from the route. "Near a tube station"
 * is a route preference: it lifts pubs near a listed station in scoring and
 * the constraint report says what could be checked. It never refuses a route.
 *
 * A way home is the tube named AS the ride home - "home by tube", "home on
 * the last tube", "get the tube home", "take the tube back home". Each such
 * phrase is taken out of the request first, and any tube still named after
 * that is a route rule. So "pubs near a tube, then home by tube" keeps its
 * proximity rule, and "near a tube, then home by bus" never reads the station
 * as a ride home. A tube we are not sure of stays a route rule, which is the
 * honest default.
 */
const TUBE = /\btube\b/;
const TUBE_WAY_HOME =
  /\bhome\s+(?:by|on|via)\s+(?:the\s+)?(?:last\s+)?tube\b|\btube\s+(?:back\s+)?home\b/g;

export function tubeIsARouteRule(lowerQuery: string): boolean {
  return TUBE.test(lowerQuery.replace(TUBE_WAY_HOME, " "));
}
