/**
 * One Pint Drop POST, keyed by its client request id. A response for another
 * request, or one that lands after the account changed, changes nothing.
 */
export type PintDropSubmission =
  | { phase: "posting"; requestId: string; accountRevision: number }
  | { phase: "failed"; requestId: string; message: string; canRetry: boolean }
  | { phase: "saved"; requestId: string; dropId: string };

export type PintDropSubmissionEvent =
  | { type: "succeeded"; requestId: string; accountRevision: number; dropId: string }
  | { type: "failed"; requestId: string; accountRevision: number; message: string; canRetry: boolean };

export function startPintDropSubmission(requestId: string, accountRevision: number): PintDropSubmission {
  return { phase: "posting", requestId, accountRevision };
}

export function transitionPintDropSubmission(
  state: PintDropSubmission,
  event: PintDropSubmissionEvent,
): PintDropSubmission {
  switch (event.type) {
    case "succeeded":
    case "failed":
      if (
        state.phase !== "posting" ||
        state.requestId !== event.requestId ||
        state.accountRevision !== event.accountRevision
      ) return state;
      return event.type === "succeeded"
        ? { phase: "saved", requestId: event.requestId, dropId: event.dropId }
        : { phase: "failed", requestId: event.requestId, message: event.message, canRetry: event.canRetry };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
