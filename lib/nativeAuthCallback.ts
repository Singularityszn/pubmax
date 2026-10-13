import { IOS_EMAIL_AUTH_MODE, IOS_EMAIL_CALLBACK } from "@/lib/nativeEmailPkce";
import { AUTH_ATTEMPT_PARAM, isAuthAttemptId } from "@/lib/authRedirect";

export const IOS_AUTH_CALLBACK = "pubmaxx://native-auth/callback";
export const IOS_AUTH_MODE = "ios-pkce";
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,2048}$/;

export function isNativeAuthCode(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

/** The relay carries no credentials, provider errors, or arbitrary destination. */
export function nativeAuthCallbackLocation(source: URL): string {
  const target = new URL(source.searchParams.get("native") === IOS_EMAIL_AUTH_MODE ? IOS_EMAIL_CALLBACK : IOS_AUTH_CALLBACK);
  const attempts = source.searchParams.getAll(AUTH_ATTEMPT_PARAM);
  const codes = source.searchParams.getAll("code");
  if (attempts.length === 1 && isAuthAttemptId(attempts[0])) {
    if (!source.searchParams.has("error") && !source.searchParams.has("error_code") &&
        codes.length === 1 && isNativeAuthCode(codes[0])) {
      target.searchParams.set("code", codes[0]);
    }
    target.searchParams.set(AUTH_ATTEMPT_PARAM, attempts[0]);
  }
  // RFC 9110: an absent fragment inherits the request fragment across a redirect.
  // An explicit empty fragment prevents implicit tokens reaching the custom scheme.
  return `${target.toString()}#`;
}

/** Only an active authentication session may supply this URL. Generic links reject it. */
export function readNativeAuthCallback(raw: string, expectedAttempt: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "pubmaxx:" || url.hostname !== "native-auth" ||
        url.pathname !== "/callback" || url.port || url.username || url.password || url.hash ||
        !isAuthAttemptId(expectedAttempt)) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 2 || keys.some((key) => key !== "code" && key !== AUTH_ATTEMPT_PARAM)) return null;
    const code = url.searchParams.get("code");
    return url.searchParams.get(AUTH_ATTEMPT_PARAM) === expectedAttempt && isNativeAuthCode(code) ? code : null;
  } catch {
    return null;
  }
}
