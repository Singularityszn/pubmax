// The nav's unread badge and the open thread's inbox row learn that a thread
// was read without waiting for their next read.
//
// Reading a thread is what marks its messages read (the thread route does it in
// the same GET), and the badge in the site nav is a separate surface that only
// asked the inbox on focus and once a minute. So a reader who opened the one
// unread thread went on seeing "1 unread" over a thread with nothing left in
// it. The thread announces the read here, and the nav and the inbox both listen.
//
// A window event rather than shared state: the surfaces must not import each
// other, and an Event carries no payload that could be mistaken for the count.
// Client only.

export const MESSAGES_READ_EVENT = "pubmax:messages-read";

/** Tell every listener that messages the viewer had waiting were just read. */
export function announceMessagesRead(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
}

/** Listen for {@link announceMessagesRead}. Returns the unsubscribe. */
export function subscribeMessagesRead(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(MESSAGES_READ_EVENT, listener);
  return () => window.removeEventListener(MESSAGES_READ_EVENT, listener);
}
