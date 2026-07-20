export const MAGIC_LINK_SENT_MESSAGE =
  "If that email can receive a sign-in link, it is on its way. Check your inbox and spam folder.";
export const MAGIC_LINK_RATE_LIMIT_MESSAGE =
  "Too many sign-in attempts. Wait a few minutes, then try again.";
export const MAGIC_LINK_ERROR_MESSAGE =
  "We could not send a sign-in link right now. Try again shortly.";

export type MagicLinkResult = {
  status: "sent" | "rate_limited" | "error";
  message: string;
};

type OtpError = { message?: string; status?: number; code?: string } | null;

export type PasswordlessAuthClient = {
  signInWithOtp: (input: {
    email: string;
    options: { emailRedirectTo: string; shouldCreateUser: true };
  }) => Promise<{ error: OtpError }>;
};

function isRateLimited(error: Exclude<OtpError, null>): boolean {
  const searchable = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return error.status === 429 || /rate|too many|over.*limit/.test(searchable);
}

function couldRevealAccountState(error: Exclude<OtpError, null>): boolean {
  const searchable = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return /user.*(not found|exists)|already.*registered|signup|signups|account.*exists/.test(searchable);
}

/**
 * Request a Supabase magic link without returning provider/account-specific
 * errors to the UI. The same success copy is used for every address.
 */
export async function requestMagicLink(
  auth: PasswordlessAuthClient,
  email: string,
  emailRedirectTo: string,
): Promise<MagicLinkResult> {
  try {
    const { error } = await auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo, shouldCreateUser: true },
    });
    if (!error) return { status: "sent", message: MAGIC_LINK_SENT_MESSAGE };
    if (isRateLimited(error)) {
      return { status: "rate_limited", message: MAGIC_LINK_RATE_LIMIT_MESSAGE };
    }
    // Treat account/existence policy failures exactly like a send. Revealing a
    // different state for existing vs. first-time addresses creates an oracle.
    if (couldRevealAccountState(error)) {
      return { status: "sent", message: MAGIC_LINK_SENT_MESSAGE };
    }
    return { status: "error", message: MAGIC_LINK_ERROR_MESSAGE };
  } catch {
    return { status: "error", message: MAGIC_LINK_ERROR_MESSAGE };
  }
}
