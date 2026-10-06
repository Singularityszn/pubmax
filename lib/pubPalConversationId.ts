/** ElevenLabs conversation ids. Anything else is not a session we issued. */
const PUB_PAL_CONVERSATION_ID_PATTERN = /^conv_[A-Za-z0-9]{8,64}$/;

export function isPubPalConversationId(value: string): boolean {
  return PUB_PAL_CONVERSATION_ID_PATTERN.test(value);
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
