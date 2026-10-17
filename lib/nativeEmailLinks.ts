import { AUTH_ATTEMPT_PARAM, REFERRAL_SIGNUP_PROOF_PARAM, isAuthAttemptId } from "@/lib/authRedirect";
import { isNativeAuthCode } from "@/lib/nativeAuthCallback";
import { IOS_EMAIL_AUTH_MODE } from "@/lib/nativeEmailPkce";
import { nativePlatform } from "@/lib/nativePlatform";

const ERROR_FIELDS = ["error", "error_code", "error_description"];
function isTerminalEmailError(url: URL): boolean {
  // GoTrue PKCE verify errors repeat query fields in the fragment, with sb=.
  // Consume only their shape. Provider text never enters state, storage or UI.
  if (url.searchParams.has("code") || !/^[a-z][a-z0-9_]{0,127}$/.test(url.searchParams.get("error_code") ?? "")) return false;
  const error = url.searchParams.get("error");
  if (error !== null && !["invalid_request", "unauthorized_client", "access_denied", "server_error", "temporarily_unavailable"].includes(error)) return false;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const keys = [...fragment.keys()];
  if (keys.length !== new Set(keys).size || keys.some((key) => ![...ERROR_FIELDS, "sb"].includes(key))) return false;
  if (fragment.has("sb") && fragment.get("sb") !== "") return false;
  return ERROR_FIELDS.every((key) => !fragment.has(key) || fragment.get(key) === url.searchParams.get(key));
}

export function readNativeEmailCallback(raw: string, appOrigin = "https://pubmaxxing.com"): { id: string; code: string | null } | null {
  try {
    if (raw.length > 8192) return null;
    const url = new URL(raw);
    const id = url.searchParams.get(AUTH_ATTEMPT_PARAM);
    const keys = [...url.searchParams.keys()];
    const custom = url.protocol === "pubmaxx:" && url.hostname === "native-email" && url.pathname === "/callback";
    const https = url.protocol === "https:" && url.origin === appOrigin && url.pathname === "/auth/callback" &&
      url.searchParams.get("native") === IOS_EMAIL_AUTH_MODE;
    const error = https && url.searchParams.has("error_code");
    const allowed = https ? ["code", AUTH_ATTEMPT_PARAM, "native", "next", REFERRAL_SIGNUP_PROOF_PARAM, ...(error ? ERROR_FIELDS : [])] : ["code", AUTH_ATTEMPT_PARAM];
    if ((!custom && !https) || url.port && custom || url.username || url.password || !isAuthAttemptId(id) ||
        keys.length !== new Set(keys).size || keys.some((key) => !allowed.includes(key))) return null;
    if (error) return isTerminalEmailError(url) ? { id, code: null } : null;
    if (url.hash) return null;
    const code = url.searchParams.get("code");
    // HTTPS return/proof fields are ignored. The durable initiating receipt owns both.
    return code === null || isNativeAuthCode(code) ? { id, code } : null;
  } catch { return null; }
}
export async function activateNativeEmailLinks(onCallback: (raw: string) => void, appOrigin = typeof window === "undefined" ? "https://pubmaxxing.com" : window.location.origin): Promise<() => void> {
  if (nativePlatform() !== "ios") return () => {};
  let active = true;
  let remove: (() => Promise<void>) | undefined;
  const deliver = (raw: string) => { if (active && readNativeEmailCallback(raw, appOrigin)) onCallback(raw); };
  try {
    const { App } = await import("@capacitor/app");
    const listener = await App.addListener("appUrlOpen", ({ url }) => deliver(url));
    remove = () => listener.remove();
    const launch = await App.getLaunchUrl();
    if (launch?.url) deliver(launch.url);
  } catch { /* A missing App bridge cannot deliver an authentication callback. */ }
  return () => { active = false; void remove?.().catch(() => {}); };
}
