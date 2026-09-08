import type { Page } from "@playwright/test";

/** Browser detection double; native device behavior needs separate proof. */
export async function installNativeShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "CapacitorCustomPlatform", {
      configurable: true,
      value: { name: "ios" },
    });
    // Capacitor initializes and assigns this global when plugin modules load.
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      writable: true,
      value: { isNativePlatform: () => true, getPlatform: () => "ios" },
    });
  });
}
