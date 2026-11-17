export const PASSWORD_RECOVERY_MESSAGE = "If an account matches, we sent a link";
export const PASSWORD_RECOVERY_PATH = "/auth/reset-password";

export function isPasswordRecoveryUrl(value: string): boolean {
  try { return new URL(value, "https://pubmaxxing.com").pathname === PASSWORD_RECOVERY_PATH; }
  catch { return false; }
}

export type RecoveryFormState =
  | { status: "checking" }
  | { status: "editing"; error?: string; field?: "email" | "password" | "confirm" }
  | { status: "busy"; passwordSaved?: boolean }
  | { status: "securing"; error: string }
  | { status: "complete" }
  | { status: "invalid"; expired: boolean };

export type RecoveryFormEvent =
  | { type: "link" }
  | { type: "submit" }
  | { type: "failed"; message: string; passwordSaved?: boolean; field?: "email" | "password" | "confirm" }
  | { type: "complete" }
  | { type: "invalid"; expired?: boolean };

export function recoveryFormTransition(state: RecoveryFormState, event: RecoveryFormEvent): RecoveryFormState {
  if (event.type === "link") return { status: "editing" };
  if (state.status === "complete" || state.status === "invalid") return state;
  switch (event.type) {
    case "submit": return { status: "busy", ...((state.status === "securing" || state.status === "busy" && state.passwordSaved) ? { passwordSaved: true } : {}) };
    case "failed": return event.passwordSaved
      ? { status: "securing", error: event.message }
      : { status: "editing", error: event.message, ...(event.field ? { field: event.field } : {}) };
    case "complete": return { status: "complete" };
    case "invalid": return { status: "invalid", expired: event.expired === true };
  }
}

export function recoveryToken(fragment: string): string | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const values = params.getAll("token_hash");
  return values.length === 1 && /^(?:[a-f0-9]{56}|[a-f0-9]{64})$/i.test(values[0] ?? "") ? values[0]! : null;
}
