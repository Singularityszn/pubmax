// Capacitor iOS wrap (remote-URL mode). The Next.js app is SERVER-RENDERED —
// there is no static export, so the native shell loads the production origin
// directly rather than a bundled webDir. `webDir` must still point at a real
// directory for the CLI's copy step; a two-file stub keeps cap sync from
// baking public/'s ~6 MB of datasets into the binary as dead weight — the
// placeholder index is not served in healthy remote-URL mode, while
// offline.html is served only through server.errorPath after a main-frame
// load failure.
// See docs/CAPACITOR_WRAP.md for the full wrap runbook (signing, APNs, AASA).
import type { CapacitorConfig } from "@capacitor/cli";

/** The one origin a shipped binary ever loads. */
export const PRODUCTION_SERVER_URL = "https://pubmaxxing.com";

/**
 * A LOCAL rig loads a local build. `PUBMAX_NATIVE_SERVER_URL` is read at
 * `npx cap sync` time only, so a developer can point the simulator at
 * `http://localhost:<port>` and the emulator at `http://10.0.2.2:<port>` to
 * review a checkout the site has not shipped yet (docs/CAPACITOR_WRAP.md,
 * "Reviewing a local build in the shells"). It reaches nothing a binary ships
 * with: the generated capacitor.config.json files are untracked, the value is
 * absent on every CI and store build, and `__tests__/nativeWrap.test.ts` holds
 * the unset case to production. `cleartext` follows the scheme rather than
 * being a second switch, because an http origin with it off is a blank
 * WebView on Android and nothing on screen says why.
 */
export function nativeServerUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const local = env.PUBMAX_NATIVE_SERVER_URL?.trim();
  return local ? local : PRODUCTION_SERVER_URL;
}

const serverUrl = nativeServerUrl();

const config: CapacitorConfig = {
  appId: "com.pubmaxx.app",
  appName: "PUBMAXXING",
  webDir: "native/web-stub",
  server: {
    url: serverUrl,
    ...(serverUrl.startsWith("http://") ? { cleartext: true } : {}),
    // Remote-URL mode cannot rely on the site's service worker before the
    // first successful load. Capacitor serves this bundled page when the main
    // frame cannot reach production, so an outage is honest and retryable.
    errorPath: "offline.html",
  },
  plugins: {
    // Capacitor 8 bundles SystemBars in core. CSS inset injection covers older
    // Android WebViews; the runtime seam mirrors the site's light/dark choice.
    SystemBars: {
      hidden: false,
      style: "DEFAULT",
      insetsHandling: "css",
    },
  },
};

export default config;
