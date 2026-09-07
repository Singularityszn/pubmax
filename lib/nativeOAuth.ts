// Third-party sign-in inside the native shell.
//
// On the web, `supabase.auth.signInWithOAuth` navigates the tab to the
// provider and the provider sends it back to /auth/callback. Inside the
// Capacitor shell that navigation happens in the WKWebView / Android WebView
// itself, and Google refuses to run OAuth in an embedded web view at all
// ("403 disallowed_useragent"): the person taps Continue with Google and
// lands on a Google error page with no way back into the app. Apple's flow
// loads, but a web view is not where an iPhone owner expects to type their
// Apple ID either.
//
// So inside the shell the provider page is opened in the SYSTEM browser
// (SFSafariViewController on iOS, a Chrome Custom Tab on Android) through
// @capacitor/browser, with supabase-js told to hand the URL back rather than
// navigate (`skipBrowserRedirect`). The provider then redirects to
// https://pubmaxxing.com/auth/callback, which is a universal link and an
// Android App Link (public/.well-known/apple-app-site-association,
// android/app/src/main/AndroidManifest.xml, lib/nativeDeepLinks.ts hold the
// three together), so the callback lands back in the shell's own WebView, the
// one that holds the PKCE verifier supabase-js wrote when the flow began.
//
// Off the shell every function here is a no-op, so the web keeps the
// navigation it always had. The plugin is imported dynamically after the
// canonical `isNativeApp()` probe, the idiom lib/nativeShare.ts uses, so SSR
// and the plain web never execute a native plugin path.

import { isNativeApp } from "@/lib/nativePlatform";

type NativeBrowserPlugin = {
  open: (options: { url: string; presentationStyle?: "fullscreen" | "popover" }) => Promise<void>;
  close: () => Promise<void>;
};

export type NativeOAuthDeps = {
  /** Defaults to the canonical shell probe. */
  isNative?: () => boolean;
  /** Defaults to the dynamic @capacitor/browser import. */
  loadPlugin?: () => Promise<NativeBrowserPlugin>;
};

async function loadBrowserPlugin(): Promise<NativeBrowserPlugin> {
  const { Browser } = await import("@capacitor/browser");
  return Browser;
}

/**
 * Whether an OAuth start must ask supabase-js for the provider URL instead of
 * letting it navigate the WebView. True only inside the shell.
 */
export function oauthOpensInSystemBrowser(deps: NativeOAuthDeps = {}): boolean {
  return (deps.isNative ?? isNativeApp)();
}

export type NativeOAuthOpenOutcome = "opened" | "unavailable";

/**
 * Hand the provider URL to the system browser. `unavailable` means the shell
 * could not open one, in which case the caller should fall back to the web
 * navigation rather than leave the person on a dead button.
 */
export async function openOAuthInSystemBrowser(
  url: string,
  deps: NativeOAuthDeps = {},
): Promise<NativeOAuthOpenOutcome> {
  if (!oauthOpensInSystemBrowser(deps)) return "unavailable";
  try {
    const plugin = await (deps.loadPlugin ?? loadBrowserPlugin)();
    await plugin.open({ url, presentationStyle: "fullscreen" });
    return "opened";
  } catch {
    return "unavailable";
  }
}

/** The path a provider sends the person back to. */
export const OAUTH_CALLBACK_PATH = "/auth/callback";

/** True for the callback link, which is the moment the system browser is done. */
export function isOAuthCallbackPath(path: string): boolean {
  return path === OAUTH_CALLBACK_PATH || path.startsWith(`${OAUTH_CALLBACK_PATH}?`);
}

/**
 * Close the system browser once the callback has reached the app. On iOS the
 * SFSafariViewController stays presented over the app after a universal link
 * fires, so without this the person would return to a sign-in page they had
 * already left. Android's Custom Tab goes with the task switch and the call
 * is harmless there. Never throws.
 */
export async function closeSystemBrowser(deps: NativeOAuthDeps = {}): Promise<void> {
  if (!oauthOpensInSystemBrowser(deps)) return;
  try {
    const plugin = await (deps.loadPlugin ?? loadBrowserPlugin)();
    await plugin.close();
  } catch {
    // A browser that was never open, or a platform that closes it itself.
  }
}
