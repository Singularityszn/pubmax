/**
 * A way home the reader asked for. "Then home by tube" says how the night
 * ends, not how to walk between stops: it is the soft get-home preference the
 * live last-service read answers during the night (lib/lastTrain.server.ts),
 * and it never removes a pub from the route. Every other transport word is
 * still a route rule the optimizer has no evidence for, and fails closed.
 */
const GET_HOME_TRANSPORT: ReadonlySet<string> = new Set(["tube"]);

/** The transport words that bind the route between stops. */
export function routeTransportConstraints(transportConstraints: readonly string[]): string[] {
  return transportConstraints.filter((value) => !GET_HOME_TRANSPORT.has(value));
}
