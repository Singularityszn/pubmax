import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { isNativeShareCancellation, shareViaNativeSheet } from "@/lib/nativeShare";
import { shareNightObject } from "@/lib/shareSheet";
import { whatsappShareHref } from "@/lib/shareArtifacts";

// GAP 14. The Web Share API is not implemented in the Android System WebView,
// so inside the shell `navigator.share` is absent and every share in the app
// silently became "open WhatsApp" - a shared plan, a shared pub, a shared
// night, which are the growth loops. lib/nativeShare.ts is the OS-picker seam.
//
// What these tests hold: the seam sends nothing off the shell, a dismissed
// sheet is never turned into a forced WhatsApp tab, and the web path through
// shareNightObject is byte-for-byte the one it always was.

const input = {
  title: "The Crown",
  text: "Fancy The Crown? £4.80 a pint.",
  url: "https://pubmaxxing.com/map/london?venue=the-crown",
};

describe("shareViaNativeSheet", () => {
  it("sends nothing and loads no plugin off the native shell", async () => {
    const loadPlugin = vi.fn();

    const outcome = await shareViaNativeSheet(input, {
      isNative: () => false,
      loadPlugin,
    });

    expect(outcome).toBe("unavailable");
    expect(loadPlugin).not.toHaveBeenCalled();
  });

  it("opens the OS picker inside the shell, carrying title, text and url", async () => {
    const share = vi.fn().mockResolvedValue({ activityType: "com.whatsapp" });

    const outcome = await shareViaNativeSheet(input, {
      isNative: () => true,
      loadPlugin: async () => ({ share }),
    });

    expect(outcome).toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: input.title,
      text: input.text,
      url: input.url,
      dialogTitle: input.title,
    });
  });

  it("reads the iOS plugin's own dismissal message as a cancel", async () => {
    const share = vi.fn().mockRejectedValue(new Error("Share canceled"));

    const outcome = await shareViaNativeSheet(input, {
      isNative: () => true,
      loadPlugin: async () => ({ share }),
    });

    expect(outcome).toBe("cancelled");
  });

  it("answers unavailable when the plugin is missing from an older shell", async () => {
    const outcome = await shareViaNativeSheet(input, {
      isNative: () => true,
      loadPlugin: async () => {
        throw new Error("Cannot find module '@capacitor/share'");
      },
    });

    expect(outcome).toBe("unavailable");
  });

  it("answers unavailable when the sheet genuinely fails, leaving the caller's path", async () => {
    const share = vi.fn().mockRejectedValue(new Error("no activity found"));

    const outcome = await shareViaNativeSheet(input, {
      isNative: () => true,
      loadPlugin: async () => ({ share }),
    });

    expect(outcome).toBe("unavailable");
  });

  it("reads both spellings of a cancelled sheet and nothing else", () => {
    expect(isNativeShareCancellation(new Error("Share canceled"))).toBe(true);
    expect(isNativeShareCancellation(new Error("Share cancelled"))).toBe(true);
    expect(isNativeShareCancellation("share canceled")).toBe(true);
    expect(isNativeShareCancellation(new Error("Share failed"))).toBe(false);
    expect(isNativeShareCancellation(undefined)).toBe(false);
  });
});

describe("shareNightObject inside the shell", () => {
  it("prefers the OS picker over navigator.share and over wa.me", async () => {
    const share = vi.fn();
    const openWindow = vi.fn();

    const outcome = await shareNightObject(input, {
      nav: { share },
      openWindow,
      shareNatively: async () => "shared",
    });

    expect(outcome).toBe("shared");
    expect(share).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("never forces a WhatsApp tab behind a sheet the person dismissed", async () => {
    const openWindow = vi.fn();

    const outcome = await shareNightObject(input, {
      nav: {},
      openWindow,
      shareNatively: async () => "cancelled",
    });

    expect(outcome).toBe("cancelled");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("leaves the web path exactly as it was when the seam is unavailable", async () => {
    const openWindow = vi.fn().mockReturnValue({});

    const outcome = await shareNightObject(input, {
      nav: {},
      openWindow,
      shareNatively: async () => "unavailable",
    });

    expect(outcome).toBe("whatsapp");
    expect(openWindow).toHaveBeenCalledWith(whatsappShareHref(input.text, input.url));
  });

  it("still lets navigator.share answer first on a browser that has it", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn();

    const outcome = await shareNightObject(input, {
      nav: { share },
      openWindow,
      shareNatively: async () => "unavailable",
    });

    expect(outcome).toBe("shared");
    expect(share).toHaveBeenCalledOnce();
  });
});

// `npx cap sync` is not optional after a plugin lands: AGENTS.md records that
// skipping it once left the Android project without @capacitor/haptics
// entirely, which fails in silence on a device and is invisible to every unit
// test. This fence holds the two generated native manifests to package.json's
// own runtime plugin list, so the next plugin cannot ship half-wired either.
describe("native plugin projects carry every declared Capacitor plugin", () => {
  const root = join(__dirname, "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  // The platform packages themselves are the projects, not plugins inside them.
  const PLATFORM_PACKAGES = new Set(["@capacitor/android", "@capacitor/ios", "@capacitor/core", "@capacitor/cli"]);
  // Both scopes a Capacitor plugin arrives under here: the official one and the
  // capacitor-community org. A community plugin is wired into the two generated
  // manifests by the same cap sync and fails in exactly the same silence, so it
  // belongs inside this fence rather than beside it.
  const PLUGIN_SCOPES = ["@capacitor/", "@capacitor-community/"];
  const plugins = Object.keys(pkg.dependencies)
    .filter((name) => PLUGIN_SCOPES.some((scope) => name.startsWith(scope)) && !PLATFORM_PACKAGES.has(name))
    .sort();

  it("declares @capacitor/share as a runtime dependency", () => {
    expect(plugins).toContain("@capacitor/share");
  });

  it("declares the store review plugin as a runtime dependency", () => {
    expect(plugins).toContain("@capacitor-community/in-app-review");
  });

  it("includes every plugin in the Android Gradle settings", () => {
    const gradle = readFileSync(join(root, "android/capacitor.settings.gradle"), "utf8");
    for (const plugin of plugins) {
      expect(gradle, `${plugin} is missing from android/capacitor.settings.gradle - run npx cap sync android`)
        .toContain(`node_modules/${plugin}/android`);
    }
  });

  it("includes every plugin in the iOS Swift package", () => {
    const swift = readFileSync(join(root, "ios/App/CapApp-SPM/Package.swift"), "utf8");
    for (const plugin of plugins) {
      expect(swift, `${plugin} is missing from ios/App/CapApp-SPM/Package.swift - run npx cap sync ios`)
        .toContain(`node_modules/${plugin}"`);
    }
  });
});
