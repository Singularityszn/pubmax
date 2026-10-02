/** The one topic a new Pint Drop announces on. Payload-free; see migration 0170. */
export const PINT_DROPS_LIVE_TOPIC = "live:pint-drops";

/** The broadcast event on that topic. The body is always empty. */
export const PINT_DROPS_LIVE_EVENT = "drop";
