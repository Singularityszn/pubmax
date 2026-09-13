import type { Page } from "@playwright/test";

// A NATIVE SHELL STUB HAS TO SURVIVE @capacitor/core, NOT ONLY THE FIRST READ.
//
// `lib/nativePlatform.ts` probes `window.Capacitor`, so a bare
// `{ isNativePlatform: () => true }` answers the first read. But once the page
// is native, `components/DeferredShellExtras.tsx` mounts `NativeSystemBars`,
// and `lib/nativeSystemBars.ts` imports `@capacitor/core`. Core's
// `createCapacitor` writes its own `isNativePlatform` and `getPlatform` onto
// that same object, and it reads the platform from the real bridge
// (`androidBridge` or `webkit.messageHandlers.bridge`). A browser has neither,
// so a bare stub turns to "web" a moment after hydration: `/onboarding` then
// sends the reader home and every native branch acts as the web one.
//
// `window.CapacitorCustomPlatform` is core's own seam for a platform with no
// bridge. With it core reports the stubbed platform, and a plugin such as
// SystemBars falls back to its web implementation, which rejects and is caught.
export async function installNativeShell(
  page: Page,
  platform: "ios" | "android" = "ios",
): Promise<void> {
  await page.addInitScript((name) => {
    Object.defineProperty(window, "CapacitorCustomPlatform", {
      configurable: true,
      value: { name, plugins: {} },
    });
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: {
        isNativePlatform: () => true,
        getPlatform: () => name,
      },
    });
  }, platform);
}
