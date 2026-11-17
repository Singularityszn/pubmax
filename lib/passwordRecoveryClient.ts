import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createPasswordRecoveryAuth } from "@/lib/authClient";
import { checkPassword, passwordUpdateErrorMessage } from "@/lib/passwordPolicy";

type RecoveryAuth = Pick<SupabaseClient["auth"], "verifyOtp" | "updateUser" | "signOut" | "getSession">;
type RecoveryResult =
  | { status: "saved"; session: Session }
  | { status: "invalid" }
  | { status: "sign-in" }
  | { status: "retry"; passwordSaved: boolean; message: string; field?: "password" };

export async function createPasswordRecoveryFinisher(tokenHash: string) {
  const auth = await createPasswordRecoveryAuth();
  if (!auth) throw new Error("Password recovery is unavailable. Try again shortly.");
  return Object.assign(passwordRecoveryFinisher(auth, tokenHash), { dispose: () => auth.dispose() });
}

// This private client keeps the recovery session out of persistent storage until the password and other sessions are secured.
export function passwordRecoveryFinisher(auth: RecoveryAuth, tokenHash: string) {
  let session: Session | null = null;
  let passwordSaved = false;
  return async (password: string, current: () => boolean = () => true): Promise<RecoveryResult> => {
    const retry = (message: string, field?: "password"): RecoveryResult => ({ status: "retry", passwordSaved, message, ...(field ? { field } : {}) });
    const cancelled = () => retry(passwordSaved
      ? "Your password is saved. Try again to finish signing in."
      : "Your sign-in changed. Try again to continue.");
    try {
      if (!current()) return cancelled();
      if (!passwordSaved) {
        const check = checkPassword(password);
        if (!check.ok) return retry(check.message, "password");
      }
      if (!session) {
        const verified = await auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (verified.error?.code === "otp_expired") return { status: "invalid" };
        if (verified.error || !verified.data.session) return retry("Could not check your reset link. Try again.");
        session = verified.data.session;
      }
      if (!current()) return cancelled();
      if (!passwordSaved) {
        const updated = await auth.updateUser({ password });
        if (updated.error) return retry(passwordUpdateErrorMessage(updated.error), ["same_password", "weak_password"].includes(updated.error.code ?? "") ? "password" : undefined);
        passwordSaved = true;
      }
      if (!current()) return cancelled();
      const revoked = await auth.signOut({ scope: "others" });
      if (revoked.error) return retry("Your password is saved. Try again to finish signing in.");
      if (!current()) return cancelled();
      const active = await auth.getSession();
      if (!current()) return cancelled();
      if (active.error || !active.data.session) return { status: "sign-in" };
      return { status: "saved", session: active.data.session };
    } catch {
      return retry(passwordSaved
        ? "Your password is saved. Try again to finish signing in."
        : "Could not reset your password. Check your connection and try again.");
    }
  };
}
