export const PASSWORD_RECOVERY_MESSAGE = "If an account matches, we sent a link";
export const PASSWORD_RECOVERY_PATH = "/auth/reset-password";

export type RecoveryFormState =
  | { status: "editing"; error?: string }
  | { status: "busy" }
  | { status: "securing"; error: string }
  | { status: "complete" }
  | { status: "invalid" };

export type RecoveryFormEvent =
  | { type: "link" }
  | { type: "submit" }
  | { type: "failed"; message: string; passwordSaved?: boolean }
  | { type: "complete" }
  | { type: "invalid" };

export function recoveryFormTransition(state: RecoveryFormState, event: RecoveryFormEvent): RecoveryFormState {
  if (event.type === "link") return { status: "editing" };
  if (state.status === "complete" || state.status === "invalid") return state;
  switch (event.type) {
    case "submit": return { status: "busy" };
    case "failed": return event.passwordSaved
      ? { status: "securing", error: event.message }
      : { status: "editing", error: event.message };
    case "complete": return { status: "complete" };
    case "invalid": return { status: "invalid" };
  }
}

export function recoveryToken(fragment: string): string | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const values = params.getAll("token_hash");
  return values.length === 1 && /^(?:[a-f0-9]{56}|[a-f0-9]{64})$/i.test(values[0] ?? "") ? values[0]! : null;
}
