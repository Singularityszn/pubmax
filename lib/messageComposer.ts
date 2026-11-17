import type { MessageDTO } from "@/lib/messages";
import type { MessagePollWrite } from "@/lib/messagePoll";
import type { PreparedPhotoUpload } from "@/lib/preparePhotoUpload";

export type MessagePhotoDraft = PreparedPhotoUpload & { previewUrl: string };
export type PendingMessageAttachment =
  | (MessagePhotoDraft & { kind: "photo"; remaining?: MessagePhotoDraft[] })
  | { kind: "venue"; venue: { id: string; name: string; area: string } }
  | { kind: "contact"; handle: string }
  | { kind: "event"; planId: string }
  | { kind: "poll"; poll: MessagePollWrite };

export type OutboxMessage = MessageDTO & { pendingPhoto?: MessagePhotoDraft; queued?: boolean };

export type ComposerActivity =
  | { phase: "ready" | "sending"; scope: string }
  | { phase: "preparing"; scope: string; completed: number; total: number }
  | { phase: "failed"; scope: string; message: string; operation: "prepare" | "send" };
type ComposerEvent =
  | { type: "reset" | "send" | "finish" | "clear-error"; scope: string }
  | { type: "prepare"; scope: string; total: number }
  | { type: "progress"; scope: string; completed: number }
  | { type: "fail"; scope: string; message: string; operation?: "prepare" | "send" };

export function transitionComposerActivity(state: ComposerActivity, event: ComposerEvent): ComposerActivity {
  if (event.type === "reset") return { phase: "ready", scope: event.scope };
  if (event.scope !== state.scope) return state;
  switch (event.type) {
    case "prepare": return state.phase === "sending" ? state : { phase: "preparing", scope: event.scope, completed: 0, total: event.total };
    case "progress": return state.phase === "preparing" ? { ...state, completed: event.completed } : state;
    case "send": return state.phase === "preparing" ? state : { phase: "sending", scope: event.scope };
    case "fail": return { phase: "failed", scope: event.scope, message: event.message, operation: event.operation ?? "send" };
    case "finish": return state.phase === "preparing" || state.phase === "sending" ? { phase: "ready", scope: event.scope } : state;
    case "clear-error": return state.phase === "failed" ? { phase: "ready", scope: event.scope } : state;
    default: { const unreachable: never = event.type; return unreachable; }
  }
}

export function messagePhotos(pending: PendingMessageAttachment | null): MessagePhotoDraft[] {
  return pending?.kind === "photo" ? [pending, ...(pending.remaining ?? [])] : [];
}

export function pendingMessageLabel(pending: PendingMessageAttachment): string {
  switch (pending.kind) {
    case "photo": return messagePhotos(pending).length > 1 ? `${messagePhotos(pending).length} photos ready to send` : "Photo ready to send";
    case "venue": return pending.venue.name;
    case "contact": return `@${pending.handle}`;
    case "event": return "Plan ready to send";
    case "poll": return pending.poll.question;
    default: { const unreachable: never = pending; return unreachable; }
  }
}

export function newMessageClientId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const hex = (length: number): string => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}
