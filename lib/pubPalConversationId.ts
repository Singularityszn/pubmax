/** ElevenLabs conversation ids. Anything else is not a session we issued. */
const PUB_PAL_CONVERSATION_ID_PATTERN = /^conv_[A-Za-z0-9]{8,64}$/;

export function isPubPalConversationId(value: string): boolean {
  return PUB_PAL_CONVERSATION_ID_PATTERN.test(value);
}
