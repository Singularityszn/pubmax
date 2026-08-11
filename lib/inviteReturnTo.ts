const INVITE_ORIGIN = "https://pubmax.invalid";
const INVITE_PATH = /^\/add\/[a-z0-9_]{3,30}$/;

/**
 * Keep invite continuation inside one add-link path. The value is carried in
 * the URL during account setup and is never written to device storage.
 */
export function safeInviteReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("?") ||
    candidate.includes("#")
  ) {
    return null;
  }
  try {
    const url = new URL(candidate, INVITE_ORIGIN);
    if (
      url.origin !== INVITE_ORIGIN ||
      url.search ||
      url.hash ||
      !INVITE_PATH.test(url.pathname)
    ) {
      return null;
    }
    return url.pathname;
  } catch {
    return null;
  }
}

export function inviteReturnToFromUrl(rawUrl: string): string | null {
  try {
    return safeInviteReturnTo(new URL(rawUrl).searchParams.get("returnTo"));
  } catch {
    return null;
  }
}
