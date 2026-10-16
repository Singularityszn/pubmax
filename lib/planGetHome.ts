/**
 * A way home the reader asked for. "Then home by tube" says how the night
 * ends, not how to walk between stops, so the word is dropped from the route
 * rules and never removes a pub from the route. Nothing here reads a last
 * service: the live last-service answer is its own surface, the one the reader
 * opens on the map. Every other transport word is still a route rule the
 * optimizer has no evidence for, and fails closed.
 */
const GET_HOME_TRANSPORT: ReadonlySet<string> = new Set(["tube"]);

/** The transport words that bind the route between stops. */
export function routeTransportConstraints(transportConstraints: readonly string[]): string[] {
  return transportConstraints.filter((value) => !GET_HOME_TRANSPORT.has(value));
}
