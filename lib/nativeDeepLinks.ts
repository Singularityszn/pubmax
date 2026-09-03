// Native universal/app-link routing seam. Platform manifests decide which
// HTTPS links may open the binary; this module applies the second fence by
// accepting only the production origin and explicitly supported route families.

import { isNativeApp } from "@/lib/nativePlatform";
import { navigateNativeBrowser } from "@/lib/nativeNavigation";

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
] as const;

/**
 * `/map` is EXACT rather than a prefix because the map's own deep link carries
 * its pub in the query (`/map?sel=<venueId>`, the one contract in
 * docs/MOBILE_FLOW_SPEC.md §3) and the path itself has nothing after it. The
 * prefix above covers `/map/<city>`, which is a different route.
 */
const ALLOWED_EXACT_PATHS = ["/auth/callback", "/map"] as const;

/** Both halves of the allow list, in the order the manifests declare them. */
export const NATIVE_DEEP_LINK_PATH_PREFIXES: readonly string[] = ALLOWED_PATH_PREFIXES;
export const NATIVE_DEEP_LINK_EXACT_PATHS: readonly string[] = ALLOWED_EXACT_PATHS;

function isAllowedPath(pathname: string): boolean {
  return (
    ALLOWED_EXACT_PATHS.some((path) => pathname === path) ||
    ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/** Convert a native-open URL to an internal Next path, or reject it. */
export function nativeDeepLinkPath(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== APP_ORIGIN) return null;
    if (!isAllowedPath(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
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
      if (path) navigate(path);
    };

    const listener = await App.addListener("appUrlOpen", ({ url }) => route(url));
    removeListener = () => listener.remove();

    const launch = await App.getLaunchUrl();
    if (launch?.url) route(launch.url);

    return () => {
      void removeListener?.();
      removeListener = undefined;
    };
  } catch {
    void removeListener?.();
    return () => {};
  }
}
