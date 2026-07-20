import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import capacitorConfig from "../capacitor.config";

const rootFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Capacitor wrapped-build contract", () => {
  it("loads production remotely and has a bundled, truthful outage fallback", () => {
    expect(capacitorConfig.webDir).toBe("native/web-stub");
    expect(capacitorConfig.server?.url).toBe("https://pubmaxxing.com");
    expect(capacitorConfig.server?.cleartext).not.toBe(true);
    expect(capacitorConfig.server?.errorPath).toBe("offline.html");

    const offline = rootFile("native/web-stub/offline.html");
    expect(offline).toContain("Nothing stale is being shown.");
    expect(offline).toContain("prefers-color-scheme: dark");
    expect(offline).toContain("env(safe-area-inset-top, 0px)");
    expect(offline).toContain("https://pubmaxxing.com");
  });

  it("keeps system bars visible and enables Capacitor safe-area correction", () => {
    expect(capacitorConfig.plugins?.SystemBars).toEqual({
      hidden: false,
      style: "DEFAULT",
      insetsHandling: "css",
    });
  });

  it("preserves iOS camera permissions, APNs forwarding, and universal-link forwarding", () => {
    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain("NSCameraUsageDescription");
    expect(info).toContain("NSPhotoLibraryUsageDescription");
    expect(info).not.toContain("NSPhotoLibraryAddUsageDescription");

    const delegate = rootFile("ios/App/App/AppDelegate.swift");
    expect(delegate).toContain("capacitorDidRegisterForRemoteNotifications");
    expect(delegate).toContain("capacitorDidFailToRegisterForRemoteNotifications");
    expect(delegate).toContain("continue userActivity: NSUserActivity");
    expect(delegate).toContain("ApplicationDelegateProxy.shared.application");

    expect(rootFile("ios/App/CapApp-SPM/Package.swift")).toContain("CapacitorApp");
    expect(rootFile("android/app/capacitor.build.gradle")).toContain(
      "implementation project(':capacitor-app')",
    );
  });

  it("declares the same supported paths for iOS and Android deep links", () => {
    const aasa = JSON.parse(
      rootFile("public/.well-known/apple-app-site-association"),
    ) as { applinks: { details: Array<{ appIDs: string[]; components: Array<{ "/": string }> }> } };
    const detail = aasa.applinks.details[0];
    expect(detail?.appIDs).toEqual(["TEAMID.com.pubmaxx.app"]);
    expect(detail?.components.map((component) => component["/"])).toEqual([
      "/plan/*",
      "/rounds/*",
      "/p/*",
    ]);

    const manifest = rootFile("android/app/src/main/AndroidManifest.xml");
    for (const path of ["/plan/", "/rounds/", "/p/"]) {
      expect(manifest).toContain(`android:pathPrefix="${path}"`);
    }
    expect(manifest).toContain('android:host="pubmaxxing.com"');
    expect(manifest).toContain('android:launchMode="singleTask"');
  });
});
