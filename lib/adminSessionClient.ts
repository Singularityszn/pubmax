import { errorMessageFrom, readApiJson } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";

/**
 * Spending a moderator token, and PROVING the cookie landed before the reload.
 *
 * THE DEFECT THIS EXISTS FOR: the session cookie is `Secure` under
 * NODE_ENV=production, so a deployment served without TLS drops it while the
 * POST still answers 200. The form reloaded on that 200, met the same token
 * form again, and said nothing, which reads as a correct token being ignored.
 *
 * The outcome is THREE-WAY, like every other read here: a session GoTrue-style
 * answer of `false` is a cookie the browser REFUSED to keep, while a confirm we
 * could not run is a fact about us and says so rather than blaming the browser.
 */

export const ADMIN_SESSION_UNREACHABLE_MESSAGE =
  "Could not reach the server. Try again.";
export const ADMIN_SESSION_REFUSED_FALLBACK = "Not authorised.";
export const ADMIN_SESSION_NOT_KEPT_MESSAGE =
  "Sign-in did not stick - this page needs HTTPS.";
export const ADMIN_SESSION_UNCONFIRMED_MESSAGE =
  "Could not confirm the sign-in. Try again.";

export const ADMIN_SESSION_PATH = "/api/admin/session";

export type AdminSessionSubmitOutcome =
  | { status: "open" }
  | { status: "refused"; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Whether the browser kept the session cookie the POST just handed it. */
async function confirmAdminSession(
  fetchImpl: FetchLike,
): Promise<AdminSessionSubmitOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(ADMIN_SESSION_PATH, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    });
  } catch {
    return { status: "refused", message: ADMIN_SESSION_UNCONFIRMED_MESSAGE };
  }
  if (!res.ok) {
    discardBody(res);
    return { status: "refused", message: ADMIN_SESSION_UNCONFIRMED_MESSAGE };
  }
  const body = await readApiJson(res).catch(() => null);
  discardBody(res);
  const authenticated =
    body && typeof body === "object"
      ? (body as { authenticated?: unknown }).authenticated
      : undefined;
  if (authenticated === true) return { status: "open" };
  if (authenticated === false) {
    return { status: "refused", message: ADMIN_SESSION_NOT_KEPT_MESSAGE };
  }
  return { status: "refused", message: ADMIN_SESSION_UNCONFIRMED_MESSAGE };
}

export async function submitAdminToken(
  token: string,
  fetchImpl: FetchLike,
): Promise<AdminSessionSubmitOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(ADMIN_SESSION_PATH, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    });
  } catch {
    return { status: "refused", message: ADMIN_SESSION_UNREACHABLE_MESSAGE };
  }
  if (!res.ok) {
    const body = await readApiJson(res).catch(() => null);
    discardBody(res);
    return {
      status: "refused",
      message: errorMessageFrom(body, ADMIN_SESSION_REFUSED_FALLBACK),
    };
  }
  discardBody(res);
  return confirmAdminSession(fetchImpl);
}
