// Capacitor iOS wrap (remote-URL mode). The Next.js app is SERVER-RENDERED —
// there is no static export, so the native shell loads the production origin
// directly rather than a bundled webDir. `webDir` must still point at a real
// directory for the CLI's copy step; a one-file stub keeps cap sync from
// baking public/'s ~6 MB of datasets into the binary as dead weight — the
// stub is never actually served inside the shell.
// See docs/CAPACITOR_WRAP.md for the full wrap runbook (signing, APNs, AASA).
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pubmaxx.app",
  appName: "PUBMAXX",
  webDir: "native/web-stub",
  server: {
    url: "https://pubmaxxing.com",
  },
};

export default config;
