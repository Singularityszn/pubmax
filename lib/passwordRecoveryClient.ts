import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createPasswordRecoveryAuth } from "@/lib/authClient";
import { checkPassword, passwordUpdateErrorMessage } from "@/lib/passwordPolicy";

type RecoveryAuth = Pick<SupabaseClient["auth"], "verifyOtp" | "updateUser" | "signOut" | "getSession">;
type RecoveryResult =
  | { status: "saved"; session: Session }
  | { status: "invalid" }
  | { status: "retry"; passwordSaved: boolean; message: string };

export async function createPasswordRecoveryFinisher(tokenHash: string) {
  const auth = await createPasswordRecoveryAuth();
  if (!auth) throw new Error("Password recovery is unavailable. Try again shortly.");
  return Object.assign(passwordRecoveryFinisher(auth, tokenHash), { dispose: () => auth.dispose() });
}

// This private client keeps the recovery session off the device until the password and sessions are secured.
export function passwordRecoveryFinisher(auth: RecoveryAuth, tokenHash: string) {
  let session: Session | null = null;
  let passwordSaved = false;
  return async (password: string): Promise<RecoveryResult> => {
    const retry = (message: string): RecoveryResult => ({ status: "retry", passwordSaved, message });
    try {
      if (!passwordSaved) {
        const check = checkPassword(password);
        if (!check.ok) return retry(check.message);
      }
      if (!session) {
        const verified = await auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (verified.error?.code === "otp_expired") return { status: "invalid" };
        if (verified.error || !verified.data.session) return retry("Could not check your reset link. Try again.");
        session = verified.data.session;
      }
      if (!passwordSaved) {
        const updated = await auth.updateUser({ password });
        if (updated.error) return retry(passwordUpdateErrorMessage(updated.error));
        passwordSaved = true;
      }
      const revoked = await auth.signOut({ scope: "others" });
      if (revoked.error) return retry("Your password is saved. Try again to sign out your other sessions.");
      const current = await auth.getSession();
      if (current.error || !current.data.session) return retry("Your password is saved. Sign in with it to continue.");
      return { status: "saved", session: current.data.session };
    } catch {
      return retry(passwordSaved
        ? "Your password is saved. Try again to finish securing your account."
        : "Could not reset your password. Check your connection and try again.");
    }
  };
}
