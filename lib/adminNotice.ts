/**
 * What the moderator console says back, and how loudly.
 *
 * THE DEFECT THIS EXISTS FOR: the console decided whether a line was announced
 * by matching its own copy (`message.startsWith("Not authorised")`), so a
 * refusal worded any other way rendered as a quiet `role="status"` a screen
 * reader may never speak. A notice carries its own tone, because the code that
 * writes a line is the only code that knows whether it is a refusal.
 */

export type AdminNoticeTone = "alert" | "status";

export type AdminNotice = {
  text: string;
  tone: AdminNoticeTone;
};

/** Something went wrong, or was refused. Announced. */
export function adminAlert(text: string): AdminNotice {
  return { text, tone: "alert" };
}

/** A receipt for something that worked. Polite. */
export function adminStatus(text: string): AdminNotice {
  return { text, tone: "status" };
}

/**
 * Why a console queue could not be shown.
 *
 * THE DEFECT THIS EXISTS FOR: the Social queue answered four different
 * questions with one word. A closed console session, a refusal from the server,
 * an answer we could not parse and a server we never reached all rendered as
 * "Social post moderation is unavailable." with nothing to press. A moderator
 * could not tell whether the fault was theirs to fix, and had no way onward
 * either, which is the door-slam the friction-voice law forbids.
 *
 * These are the operator's OWN states, so naming the cause is what makes the
 * line actionable; this is not the drinker-facing plumbing that law scrubs.
 */
export const ADMIN_QUEUE_UNAVAILABLE_REASONS = [
  /** The console session is not open, so the request was never worth sending. */
  "session",
  /** The server answered, and refused. */
  "refused",
  /** The server answered with something this console cannot read. */
  "unreadable",
  /** The request never arrived: offline, DNS, a timeout. */
  "unreachable",
] as const;

export type AdminQueueUnavailableReason =
  (typeof ADMIN_QUEUE_UNAVAILABLE_REASONS)[number];

const QUEUE_UNAVAILABLE_CAUSE: Readonly<
  Record<AdminQueueUnavailableReason, string>
> = {
  session: "The console session is not open.",
  refused: "The server refused the request.",
  unreadable: "The answer could not be read.",
  unreachable: "The server could not be reached.",
};

/**
 * What a queue says when it has nothing to show and that is our fault.
 *
 * Every reason is worth another go - a retry mints a fresh session before it
 * asks again - so the surface that renders this owes a control beside it.
 */
export function adminQueueUnavailable(
  queue: string,
  reason: AdminQueueUnavailableReason,
): AdminNotice {
  return adminAlert(`Could not load ${queue}. ${QUEUE_UNAVAILABLE_CAUSE[reason]}`);
}
