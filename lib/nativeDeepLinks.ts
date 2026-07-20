// Native universal/app-link routing seam. Platform manifests decide which
// HTTPS links may open the binary; this module applies the second fence by
// accepting only the production origin and explicitly supported route families.

import { isNativeApp } from "@/lib/nativePlatform";

const APP_ORIGIN = "https://pubmaxxing.com";
const ALLOWED_PATH_PREFIXES = ["/plan/", "/rounds/", "/p/"] as const;

/** Convert a native-open URL to an internal Next path, or reject it. */
export function nativeDeepLinkPath(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== APP_ORIGIN) return null;
    if (!ALLOWED_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function navigateBrowser(path: string): void {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== path) window.location.assign(path);
}

/**
 * Route both cold-start (`getLaunchUrl`) and warm (`appUrlOpen`) links. Returns
 * an idempotent listener cleanup; web/SSR and plugin failure are safe no-ops.
 */
export async function activateNativeDeepLinks(
  navigate: (path: string) => void = navigateBrowser,
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
