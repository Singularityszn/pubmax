/**
 * Pal thread ids: ElevenLabs conversation ids, plus the local ids below. Anything
 * else is not a session we issued. The shape is also the durable store's check
 * constraint (migration 0169), which is why a local id keeps it.
 */
const PUB_PAL_CONVERSATION_ID_PATTERN = /^conv_[A-Za-z0-9]{8,64}$/;

/** Current conversation correlation expires after two idle minutes. */
export const PUB_PAL_CONVERSATION_IDLE_MS = 2 * 60_000;

export function isPubPalConversationId(value: string): boolean {
  return PUB_PAL_CONVERSATION_ID_PATTERN.test(value);
}

// A first answer Pal gives from its own records opens no provider session, yet
// the follow-up must still read that turn back. Such a thread gets a local id:
// `conv_pal` and 32 random characters, a length no ElevenLabs id has.
const PAL_LOCAL_THREAD_PREFIX = "conv_pal";
const PAL_LOCAL_THREAD_ID_PATTERN = /^conv_pal[A-Za-z0-9]{32}$/;
const PAL_LOCAL_THREAD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** True for a thread Pal issued itself; the provider has never seen it. */
export function isPalLocalThreadId(value: string): boolean {
  return PAL_LOCAL_THREAD_ID_PATTERN.test(value);
}

export function newPalLocalThreadId(): string {
  let id = PAL_LOCAL_THREAD_PREFIX;
  // 62 does not divide 256, so the 8 highest byte values are drawn again.
  while (id.length < PAL_LOCAL_THREAD_PREFIX.length + 32) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < 248 && id.length < PAL_LOCAL_THREAD_PREFIX.length + 32) {
        id += PAL_LOCAL_THREAD_ALPHABET[byte % 62];
      }
    }
  }
  return id;
}

/**
 * The conversation id inside an ElevenLabs signed URL. The get-signed-url reply
 * carries `signed_url` alone, and `include_conversation_id=true` puts the id in
 * that URL's query string. Returns "" for anything that is not one of our ids.
 */
export function conversationIdFromSignedUrl(signedUrl: string): string {
  try {
    const id = new URL(signedUrl).searchParams.get("conversation_id")?.trim() ?? "";
    return isPubPalConversationId(id) ? id : "";
  } catch {
    return "";
  }
}
