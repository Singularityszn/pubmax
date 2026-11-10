import type { MessagePollWrite } from "@/lib/messagePoll";

type SendAttachment =
  | { kind: "photo"; file: Pick<File, "type"> }
  | { kind: "venue"; venue: { id: string } }
  | { kind: "contact"; handle: string }
  | { kind: "event"; planId: string }
  | { kind: "poll"; poll: MessagePollWrite };

export type MessageSendAttempt = {
  key: string;
  payload: string;
  photo: Uint8Array | null;
};

export function messageSendPayload(input: {
  conversationId: string;
  senderId: string;
  handle: string;
  body: string;
  attachment: SendAttachment | null;
}) {
  const attachment = input.attachment;
  const post = {
    action: "send",
    handle: input.handle,
    body: input.body,
    ...(attachment?.kind === "venue" ? { venueId: attachment.venue.id } : {}),
    ...(attachment?.kind === "contact" ? { contactHandle: attachment.handle } : {}),
    ...(attachment?.kind === "event" ? { planId: attachment.planId } : {}),
    ...(attachment?.kind === "poll"
      ? { poll: { question: attachment.poll.question, options: attachment.poll.options } }
      : {}),
  };
  return {
    post,
    payload: JSON.stringify({
      conversationId: input.conversationId,
      senderId: input.senderId,
      post,
      photoType: attachment?.kind === "photo" ? attachment.file.type : null,
    }),
  };
}

export function retainedMessageSendKey(
  previous: MessageSendAttempt | null,
  payload: string,
  photo: Uint8Array | null,
): string | null {
  if (!previous || previous.payload !== payload) return null;
  if (previous.photo === null) return photo === null ? previous.key : null;
  if (photo === null || previous.photo.length !== photo.length) return null;
  return previous.photo.every((byte, index) => byte === photo[index]) ? previous.key : null;
}
