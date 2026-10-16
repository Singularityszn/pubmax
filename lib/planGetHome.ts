/**
 * Whether a tube the reader named is their way HOME rather than a rule for the
 * route between stops. "Then home by tube" says how the night ends, so it is
 * no route rule and never removes a pub from the route. "Near a tube station"
 * is a rule the optimizer has no evidence for, so it stays one: the route
 * fails closed and the answer names the need it missed.
 *
 * The test is the two words in one breath, in either order, because that is
 * what the phrasing is - "home by tube", "tube home", "get the tube home",
 * "home on the last tube". A tube named well away from any mention of home
 * stays a route rule, which is the honest default for a reading we are not
 * sure of.
 */
const TUBE = /\btube\b/;
const TUBE_WAY_HOME = /\btube\b[^.!?]{0,24}\bhome\b|\bhome\b[^.!?]{0,24}\btube\b/;

export function tubeIsARouteRule(lowerQuery: string): boolean {
  return TUBE.test(lowerQuery) && !TUBE_WAY_HOME.test(lowerQuery);
}
