// The Realtime topics the messaging surfaces listen on. A leaf: the browser
// subscriber (lib/messagesRealtime.ts) and the server broadcaster
// (lib/messagesBroadcast.server.ts) both import it, so the two cannot drift on
// a channel name. Nothing here reads content; a topic names a place a signal
// goes, never what the signal says.

/** One conversation's thread. */
export function messagesThreadTopic(conversationId: string): string {
  return `live:messages:${conversationId}`;
}

/** One handle's inbox list. */
export function messagesInboxTopic(handle: string): string {
  return `live:inbox:${handle}`;
}
