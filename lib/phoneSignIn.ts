// Phone sign-in: a code sent by text message, typed back on the same page.
//
// This is the whole policy and it is a pure leaf. The browser Supabase client is
// passed in, so the rules are provable without a network.
//
// WHY UK MOBILES ONLY. Every text costs money, and a phone door that takes any
// number in the world is how "SMS pumping" works: a script asks for codes to
// premium ranges abroad and the sender pays the bill. PUBMAXX is London first,
// so the door takes a UK mobile (07..., +44 7...) and nothing else. Widening it
// is a change to `PHONE_SIGN_IN_COUNTRY_CODES`, never a second parser. The
// Supabase door can still be called directly with the public key, so the SMS
// provider's own country list is the fence that holds, and the captain's setup
// steps say so. This leaf keeps honest callers from spending money by mistake.
//
// WHY THE ANSWERS ARE NEUTRAL. A sent code and an unknown number answer the
// same words, exactly like the email link (lib/passwordlessAuth.ts), so the
// phone door is not a way to ask whether a number has an account.

import { AUTH_ACCOUNT_BANNED_MESSAGE, isGoTrueUserBannedError } from "@/lib/authAccountBan";

const PHONE_SIGN_IN_COUNTRY_CODES = ["44"] as const;

/** Supabase's default gap between two texts to one number. */
export const PHONE_CODE_RESEND_SECONDS = 60;

export const PHONE_NUMBER_INVALID_MESSAGE =
  "Enter a UK mobile number, like 07700 900123.";
export const PHONE_CODE_SENT_MESSAGE =
  "If that number can get texts, a code is on its way.";
export const PHONE_CODE_RATE_LIMIT_MESSAGE =
  "Too many codes asked for. Wait a few minutes, then try again.";
export const PHONE_CODE_SEND_ERROR_MESSAGE =
  "We could not send a code right now. Try again shortly.";
export const PHONE_CODE_FORMAT_MESSAGE = "Enter the code from the text.";
export const PHONE_CODE_WRONG_MESSAGE =
  "That code did not work. Check it, or send a new one.";
export const PHONE_CODE_CHECK_ERROR_MESSAGE =
  "We could not check that code right now. Try again shortly.";

export type PhoneCodeRequestResult = {
  status: "sent" | "invalid" | "rate_limited" | "error";
  message: string;
};

export type PhoneCodeCheckResult<SessionValue> =
  | { status: "signed_in"; session: SessionValue }
  | { status: "invalid" | "wrong_code" | "banned" | "rate_limited" | "error"; message: string };

type AuthError = { message?: string; status?: number; code?: string } | null;

export type PhoneSignInAuthClient<SessionValue> = {
  signInWithOtp: (input: {
    phone: string;
    options: { shouldCreateUser: true; channel: "sms" };
  }) => Promise<{ error: AuthError }>;
  verifyOtp: (input: {
    phone: string;
    token: string;
    type: "sms";
  }) => Promise<{ data: { session: SessionValue | null }; error: AuthError }>;
};

const UK_MOBILE_NATIONAL = /^7\d{9}$/;

/**
 * Read what a person typed as a UK mobile number in E.164 form (`+447...`), or
 * null. Spaces, dashes, dots and brackets are ignored. The national `0`, the
 * `+44` and the `0044` prefixes are all accepted, and so is the common
 * `+44 (0) 7...` way of writing it.
 */
export function parsePhoneNumber(input: string): string | null {
  if (typeof input !== "string") return null;
  const compact = input.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  let national: string;
  if (compact.startsWith("+44")) national = compact.slice(3);
  else if (compact.startsWith("0044")) national = compact.slice(4);
  else if (compact.startsWith("+")) return null;
  else if (compact.startsWith("0")) national = compact.slice(1);
  else return null;
  // "+44 (0) 7700..." keeps a trunk zero after the country code.
  if (national.startsWith("0")) national = national.slice(1);
  if (!UK_MOBILE_NATIONAL.test(national)) return null;
  return `+${PHONE_SIGN_IN_COUNTRY_CODES[0]}${national}`;
}

/** The number as a person reads it back: `07700 900 123`, never the full E.164. */
export function displayPhoneNumber(e164: string): string {
  const national = e164.startsWith("+44") ? `0${e164.slice(3)}` : e164;
  return /^07\d{9}$/.test(national)
    ? `${national.slice(0, 5)} ${national.slice(5, 8)} ${national.slice(8)}`
    : national;
}

/** A code is 6 to 10 digits; Supabase sends 6 unless the dashboard says more. */
export function parsePhoneCode(input: string): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\s/g, "");
  return /^\d{6,10}$/.test(digits) ? digits : null;
}

function searchable(error: Exclude<AuthError, null>): string {
  return `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
}

function isRateLimited(error: Exclude<AuthError, null>): boolean {
  return (
    error.status === 429 ||
    error.code === "over_sms_send_rate_limit" ||
    error.code === "over_request_rate_limit" ||
    /too many|over.*limit|rate limit/.test(searchable(error))
  );
}

// The phone door is switched off, the SMS company refused, or GoTrue broke.
// These are OUR faults and the person is told so rather than told "sent".
const SEND_FAILURE_CODES = new Set([
  "phone_provider_disabled",
  "sms_send_failed",
  "hook_timeout",
  "hook_timeout_after_retry",
  "request_timeout",
  "unexpected_failure",
  "captcha_failed",
]);

/**
 * Ask Supabase to text a code. An account is made on first use, the same as
 * the email link. Every account-state refusal answers the "sent" words.
 */
export async function requestPhoneCode<SessionValue>(
  auth: PhoneSignInAuthClient<SessionValue>,
  input: string,
): Promise<PhoneCodeRequestResult> {
  const phone = parsePhoneNumber(input);
  if (!phone) return { status: "invalid", message: PHONE_NUMBER_INVALID_MESSAGE };
  try {
    const { error } = await auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true, channel: "sms" },
    });
    if (!error) return { status: "sent", message: PHONE_CODE_SENT_MESSAGE };
    if (isRateLimited(error)) {
      return { status: "rate_limited", message: PHONE_CODE_RATE_LIMIT_MESSAGE };
    }
    if (error.code && SEND_FAILURE_CODES.has(error.code)) {
      return { status: "error", message: PHONE_CODE_SEND_ERROR_MESSAGE };
    }
    if (typeof error.status === "number" && error.status >= 500) {
      return { status: "error", message: PHONE_CODE_SEND_ERROR_MESSAGE };
    }
    // A banned, unknown or signup-closed number reads exactly like a send, so
    // the door is not an oracle for which numbers hold an account.
    return { status: "sent", message: PHONE_CODE_SENT_MESSAGE };
  } catch {
    return { status: "error", message: PHONE_CODE_SEND_ERROR_MESSAGE };
  }
}

/**
 * Check the code a person typed. A wrong code and an expired one are the same
 * answer, because GoTrue gives them one error code and the fix is the same.
 */
export async function checkPhoneCode<SessionValue>(
  auth: PhoneSignInAuthClient<SessionValue>,
  phoneInput: string,
  codeInput: string,
): Promise<PhoneCodeCheckResult<SessionValue>> {
  const phone = parsePhoneNumber(phoneInput);
  if (!phone) return { status: "invalid", message: PHONE_NUMBER_INVALID_MESSAGE };
  const token = parsePhoneCode(codeInput);
  if (!token) return { status: "invalid", message: PHONE_CODE_FORMAT_MESSAGE };
  try {
    const { data, error } = await auth.verifyOtp({ phone, token, type: "sms" });
    if (!error && data.session) return { status: "signed_in", session: data.session };
    // Only the person holding the phone gets this far, so saying "banned" here
    // tells nobody else anything, exactly like the password door after a
    // right password.
    if (error && isGoTrueUserBannedError(error)) {
      return { status: "banned", message: AUTH_ACCOUNT_BANNED_MESSAGE };
    }
    if (error && isRateLimited(error)) {
      return { status: "rate_limited", message: PHONE_CODE_RATE_LIMIT_MESSAGE };
    }
    if (error && (
      (typeof error.status === "number" && error.status >= 500) ||
      (error.code && SEND_FAILURE_CODES.has(error.code))
    )) {
      return { status: "error", message: PHONE_CODE_CHECK_ERROR_MESSAGE };
    }
    return { status: "wrong_code", message: PHONE_CODE_WRONG_MESSAGE };
  } catch {
    return { status: "error", message: PHONE_CODE_CHECK_ERROR_MESSAGE };
  }
}
