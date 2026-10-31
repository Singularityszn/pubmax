// Native universal/app-link routing seam. Platform manifests decide which
// links may open the binary; this module applies the second fence by accepting
// only the production origin or the `pubmaxx://` fallback scheme, and only
// explicitly supported route families.

import {
  AUTH_ATTEMPT_PARAM,
  isActiveLocalAuthAttempt,
  isAuthResponseFragment,
  type AuthFragmentStorage,
} from "@/lib/authRedirect";
import { IOS_EMAIL_AUTH_MODE } from "@/lib/nativeEmailPkce";
import { isNativeApp } from "@/lib/nativePlatform";
import { navigateNativeBrowser } from "@/lib/nativeNavigation";
import { closeSystemBrowser, isOAuthCallbackPath } from "@/lib/nativeOAuth";

const APP_ORIGIN = "https://pubmaxxing.com";

/**
 * The route families a shared PUBMAXX link may open the binary with. This list
 * is the app's half of a THREE-WAY agreement, and the other two halves are
 * data the platforms read rather than code: the iOS
 * `public/.well-known/apple-app-site-association` components and the Android
 * `autoVerify` intent filters. `__tests__/nativeWrap.test.ts` holds all three
 * to each other, because a family added here alone silently keeps opening the
 * browser, and one added to a manifest alone hands the shell a URL this module
 * then refuses.
 *
 * `/map/` and the two venue permalinks are here because they are what a person
 * actually shares from this app: a pub, and the city someone is drinking in.
 *
 * `/add/` and `/r/` are the two links a person hands to somebody else, and they
 * are the reason the installed app has to take them: an invite that opens
 * Safari asks the one person most likely to install to sign in twice. `/r/` is
 * a 307 onto the home page's own referral fragment (app/r/[code]/route.ts), and
 * iOS hands the app the link it was given rather than the redirect's target, so
 * the family is declared here and the site resolves it as it always did.
 * `/venue/` and `/pub/` are server redirects onto `/map?sel=<id>`
 * (app/venue/[slug]/route.ts, lib/venuePermalinkRedirect.ts), so they land on
 * the same surface as the map link rather than a second pub page.
 */
const ALLOWED_PATH_PREFIXES = [
  "/plan/",
  "/rounds/",
  "/p/",
  "/map/",
  "/venue/",
  "/pub/",
  "/add/",
  "/r/",
] as const;

/**
 * `/map` is EXACT rather than a prefix because the map's own deep link carries
 * its pub in the query (`/map?sel=<venueId>`, the one contract in
 * docs/MOBILE_FLOW_SPEC.md §3) and the path itself has nothing after it. The
 * prefix above covers `/map/<city>`, which is a different route.
 *
 * `/tonight` is exact for the same reason and is here because it is where a
 * push already lands (PUSH_PATHS in lib/nativePush.ts): a notification could
 * open the night while the link somebody shared about the same night could
 * not.
 */
const ALLOWED_EXACT_PATHS = ["/auth/callback", "/map", "/tonight"] as const;

/** Both halves of the allow list, in the order the manifests declare them. */
export const NATIVE_DEEP_LINK_PATH_PREFIXES: readonly string[] = ALLOWED_PATH_PREFIXES;
export const NATIVE_DEEP_LINK_EXACT_PATHS: readonly string[] = ALLOWED_EXACT_PATHS;

/**
 * The custom scheme both shells register: `CFBundleURLTypes` in
 * ios/App/App/Info.plist and one plain intent filter in the Android manifest.
 * Universal links and App Links stay the intended path, but they only verify
 * on a signed build with the real Team ID or signing fingerprint; the scheme
 * opens on any build, so it is the fallback a rig can open today.
 *
 * It opens the same families as the verified links, written only as
 * `pubmaxx://map?sel=<id>`, the family in the host. This navigation router
 * is a credential fence. Any app on the phone can send the shell an explicit
 * intent or a scheme link, so it refuses a sign-in response fragment (tokens
 * or an error) on every other path in both forms. The HTTPS `/auth/callback`
 * accepts one only when its single `_authAttempt` is the live, unclaimed
 * attempt this device started, for Android provider and email sign-in. The
 * separate native email consumer accepts only verifier-bound PKCE returns.
 * Other apps can register the same scheme, but an intercepted code cannot be
 * exchanged without the app's verifier.
 */
export const NATIVE_URL_SCHEME = "pubmaxx";
const SCHEME_REFUSED_PATHS: readonly string[] = ["/auth/callback"];

/**
 * Families only the custom scheme opens, never a verified https link.
 *
 * `/share` is the share target (lib/nativeShareTarget.ts): another app's share
 * sheet hands the shell `pubmaxx://share?text=...&url=...`, and the page drops
 * it into the Wanted paste flow. It is scheme-only on purpose. Nobody shares a
 * `https://pubmaxxing.com/share` link, so it is in neither the AASA nor the
 * App Links filters, and the three-way agreement `__tests__/nativeWrap.test.ts`
 * holds stays exactly as it was. The share extension and the SEND intent that
 * produce the scheme link are native work the captain rebuilds.
 */
const SCHEME_ONLY_EXACT_PATHS = ["/share"] as const;
export const NATIVE_SCHEME_ONLY_EXACT_PATHS: readonly string[] = SCHEME_ONLY_EXACT_PATHS;

function isAllowedPath(pathname: string): boolean {
  return (
    ALLOWED_EXACT_PATHS.some((path) => pathname === path) ||
    ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

// `pubmaxx://map?sel=x` parses with the family as its host. An empty host is
// refused, so one link has one spelling.
function schemeLinkPath(url: URL): string | null {
  if (url.username || url.password || url.port || !url.hostname) return null;
  const pathname = `/${url.hostname}${url.pathname}`;
  if (SCHEME_REFUSED_PATHS.includes(pathname)) return null;
  if (!isAllowedPath(pathname) && !SCHEME_ONLY_EXACT_PATHS.some((path) => pathname === path)) {
    return null;
  }
  if (isAuthResponseFragment(url.hash)) return null;
  return `${pathname}${url.search}${url.hash}`;
}

export type NativeDeepLinkOptions = {
  /** The browser-wide sign-in attempt record. Defaults to the WebView's localStorage. */
  persistentStorage?: AuthFragmentStorage | null;
  now?: number;
};

function webViewAttemptStorage(): AuthFragmentStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// The sign-in return is admitted only for the one attempt this device started.
// A cross-device link or another app's tokens would otherwise reach the
// WebView as an unowned callback and ask for a one-tap confirmation.
function isOwnAuthCallback(url: URL, options: NativeDeepLinkOptions): boolean {
  const attempts = url.searchParams.getAll(AUTH_ATTEMPT_PARAM);
  if (attempts.length !== 1) return false;
  const storage = options.persistentStorage === undefined ? webViewAttemptStorage() : options.persistentStorage;
  return isActiveLocalAuthAttempt(attempts[0] ?? null, storage, options.now);
}

/** Convert a native-open URL to an internal Next path, or reject it. */
export function nativeDeepLinkPath(rawUrl: string, options: NativeDeepLinkOptions = {}): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === `${NATIVE_URL_SCHEME}:`) return schemeLinkPath(url);
    if (url.origin !== APP_ORIGIN) return null;
    // The separate email auth consumer owns this mode, including direct universal-link delivery.
    if (url.pathname === "/auth/callback" && url.searchParams.getAll("native").includes(IOS_EMAIL_AUTH_MODE)) return null;
    if (!isAllowedPath(url.pathname)) return null;
    if (url.pathname === "/auth/callback") {
      if (!isOwnAuthCallback(url, options)) return null;
    } else if (isAuthResponseFragment(url.hash)) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

// Capacitor keeps the launch intent for the life of the process. A full
// document load resets this module, but keeps the WebView's session storage.
// Store only a marker, because the launch URL can contain callback credentials.
const LAUNCH_CONSUMED_KEY = "pubmax_native_launch_consumed_v1";
let launchConsumedInDocument = false;

function launchUrlConsumed(): boolean {
  if (launchConsumedInDocument) return true;
  try {
    return window.sessionStorage.getItem(LAUNCH_CONSUMED_KEY) === "1";
  } catch {
    return false;
  }
}

function consumeLaunchUrl(): void {
  launchConsumedInDocument = true;
  try {
    window.sessionStorage.setItem(LAUNCH_CONSUMED_KEY, "1");
  } catch {
    // Storage can be unavailable. Keep the guard for this document's mounts.
  }
}

/**
 * Route both cold-start (`getLaunchUrl`) and warm (`appUrlOpen`) links. Returns
 * an idempotent listener cleanup; web/SSR and plugin failure are safe no-ops.
 */
export async function activateNativeDeepLinks(
  navigate: (path: string) => void = navigateNativeBrowser,
): Promise<() => void> {
  if (!isNativeApp()) return () => {};

  let removeListener: (() => Promise<void>) | undefined;
  try {
    const { App } = await import("@capacitor/app");
    const route = (rawUrl: string) => {
      const path = nativeDeepLinkPath(rawUrl);
      if (!path) return;
      // The provider's redirect is the moment the system browser is done
      // (lib/nativeOAuth.ts): close it before the WebView takes the callback,
      // or iOS leaves the sign-in page presented over the signed-in app.
      if (isOAuthCallbackPath(path)) {
        // Replacing the document first can discard the asynchronous plugin close.
        void closeSystemBrowser().then(() => navigate(path));
      } else {
        navigate(path);
      }
    };

    const listener = await App.addListener("appUrlOpen", ({ url }) => route(url));
    removeListener = () => listener.remove();

    if (!launchUrlConsumed()) {
      const launch = await App.getLaunchUrl();
      // Two activations may await the same native reply. Claim it before routing.
      if (!launchUrlConsumed()) {
        consumeLaunchUrl();
        if (launch?.url) route(launch.url);
      }
    }

    return () => {
      void removeListener?.();
      removeListener = undefined;
    };
  } catch {
    void removeListener?.();
    return () => {};
  }
}
