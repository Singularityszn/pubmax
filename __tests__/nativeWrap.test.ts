import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import capacitorConfig from "../capacitor.config";
import { APP_NAME } from "@/lib/brandNaming";
import {
  NATIVE_DEEP_LINK_EXACT_PATHS,
  NATIVE_DEEP_LINK_PATH_PREFIXES,
} from "@/lib/nativeDeepLinks";

const rootFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Capacitor wrapped-build contract", () => {
  it("uses the canonical app name on both native install surfaces", () => {
    expect(capacitorConfig.appName).toBe(APP_NAME);

    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain(
      `<key>CFBundleDisplayName</key>\n        <string>${APP_NAME}</string>`,
    );

    const strings = rootFile("android/app/src/main/res/values/strings.xml");
    expect(strings).toContain(`<string name="app_name">${APP_NAME}</string>`);
  });

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

  it("declares the camera on BOTH platforms, not just the one that says it in words", () => {
    // iOS states the camera in a sentence a person reads; Android states it in
    // a manifest line the operating system reads. They are ONE promise kept in
    // two files, and for a while only one of them was written down: an Android
    // build with no CAMERA line answers every capture with a silent refusal -
    // the Capacitor seam (lib/nativeCamera.ts), the `capture` inputs the
    // WebView chooser opens, and the media read a chosen photo needs, all at
    // once, with nothing on screen saying why.
    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain("NSCameraUsageDescription");

    const manifest = rootFile("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain("android.permission.CAMERA");
    // Android 13 split the old storage permission per medium, so reading the
    // photo somebody picked takes BOTH lines across the supported range.
    expect(manifest).toContain("android.permission.READ_MEDIA_IMAGES");
    expect(manifest).toContain("android.permission.READ_EXTERNAL_STORAGE");
    expect(manifest).toContain('android:maxSdkVersion="32"');
    // Nothing here asks to write to the library, on either platform.
    expect(manifest).not.toContain("android.permission.WRITE_EXTERNAL_STORAGE");
    expect(info).not.toContain("NSPhotoLibraryAddUsageDescription");
  });

  it("keeps a camera-less device inside the listing", () => {
    // Declaring the CAMERA permission implicitly declares that the hardware is
    // REQUIRED, and Play then hides the listing from every device without one.
    // A pub map is worth having on a tablet with no camera, and the seam
    // already treats a refused capture as "nothing chosen".
    const manifest = rootFile("android/app/src/main/AndroidManifest.xml");
    const features = [
      ...manifest.matchAll(/<uses-feature([^>]*)\/>/g),
    ].map((match) => match[1] ?? "");
    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature, feature).toContain('android:required="false"');
    }
    expect(
      features.some((feature) => feature.includes("android.hardware.camera")),
    ).toBe(true);
  });

  it("declares foreground location access for native nearby and walk-time flows", () => {
    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain("NSLocationWhenInUseUsageDescription");
    expect(info).not.toContain("NSLocationAlwaysAndWhenInUseUsageDescription");

    const manifest = rootFile("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain(
      'android.permission.ACCESS_COARSE_LOCATION',
    );
    expect(manifest).toContain(
      'android.permission.ACCESS_FINE_LOCATION',
    );
    expect(manifest).not.toContain(
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    );
  });

  it("uses the canonical app name in iOS permission explanations", () => {
    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain(
      `<string>${APP_NAME} uses the camera so you can take photos of your night and save them as private Moments.</string>`,
    );
    expect(info).toContain(
      `<string>${APP_NAME} uses your location while the app is open to find nearby pubs and calculate walk times.</string>`,
    );
    expect(info).toContain(
      `<string>${APP_NAME} opens your photo library so you can add existing photos to your private Moments.</string>`,
    );
  });

  it("declares the same supported paths for iOS and Android deep links", () => {
    // THREE declarations, one list. lib/nativeDeepLinks.ts is the app's fence,
    // the AASA is what iOS reads and the manifest is what Android reads. A
    // family added to one alone either keeps opening the browser or hands the
    // shell a URL the app then refuses, and neither failure says anything.
    const aasa = JSON.parse(
      rootFile("public/.well-known/apple-app-site-association"),
    ) as { applinks: { details: Array<{ appIDs: string[]; components: Array<{ "/": string }> }> } };
    const detail = aasa.applinks.details[0];
    expect(detail?.appIDs).toEqual(["TEAMID.com.pubmaxx.app"]);

    const declared = new Set(detail?.components.map((component) => component["/"]) ?? []);
    for (const prefix of NATIVE_DEEP_LINK_PATH_PREFIXES) {
      expect(declared, prefix).toContain(`${prefix}*`);
    }
    for (const path of NATIVE_DEEP_LINK_EXACT_PATHS) {
      expect(declared, path).toContain(path);
    }
    // Nothing iOS admits that the app would then refuse.
    expect(declared.size).toBe(
      NATIVE_DEEP_LINK_PATH_PREFIXES.length + NATIVE_DEEP_LINK_EXACT_PATHS.length,
    );

    const manifest = rootFile("android/app/src/main/AndroidManifest.xml");
    const verifiedFilters = [
      ...manifest.matchAll(
        /<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/g,
      ),
    ].map((match) => match[1] ?? "");
    expect(verifiedFilters).toHaveLength(
      NATIVE_DEEP_LINK_PATH_PREFIXES.length + NATIVE_DEEP_LINK_EXACT_PATHS.length,
    );
    for (const prefix of NATIVE_DEEP_LINK_PATH_PREFIXES) {
      expect(
        verifiedFilters.some((filter) =>
          filter.includes(`android:pathPrefix="${prefix}"`),
        ),
        prefix,
      ).toBe(true);
    }
    for (const path of NATIVE_DEEP_LINK_EXACT_PATHS) {
      expect(
        verifiedFilters.some((filter) => filter.includes(`android:path="${path}"`)),
        path,
      ).toBe(true);
    }
    for (const filter of verifiedFilters) {
      expect(filter).toContain('android:name="android.intent.action.VIEW"');
      expect(filter).toContain('android:name="android.intent.category.BROWSABLE"');
      expect(filter).toContain('android:scheme="https"');
      expect(filter).toContain('android:host="pubmaxxing.com"');
    }
    expect(manifest).toContain('android:launchMode="singleTask"');
  });

  it("publishes an Android App Links statement naming this exact binary", () => {
    // The AASA above is what iOS reads; this is what Android's verifier reads,
    // and it is the ONLY thing standing between a verified App Link and a link
    // that quietly keeps opening the browser. It is not path-scoped - the
    // relation hands the whole host to the app - so the paths stay the intent
    // filters' business and what this file has to get right is the IDENTITY.
    const statements = JSON.parse(
      rootFile("public/.well-known/assetlinks.json"),
    ) as Array<{
      relation: string[];
      target: {
        namespace: string;
        package_name: string;
        sha256_cert_fingerprints: string[];
      };
    }>;
    expect(statements).toHaveLength(1);
    const statement = statements[0];
    expect(statement?.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(statement?.target.namespace).toBe("android_app");

    // One binary, named the same way in all three places it is named.
    expect(statement?.target.package_name).toBe(capacitorConfig.appId);
    expect(rootFile("android/app/build.gradle")).toContain(
      `applicationId "${capacitorConfig.appId}"`,
    );

    // The fingerprint is Google's app-signing certificate, which does not exist
    // until the account does. It stays an obvious placeholder rather than a
    // plausible-looking hex string somebody could mistake for live.
    const fingerprints = statement?.target.sha256_cert_fingerprints ?? [];
    expect(fingerprints).toHaveLength(1);
    expect(fingerprints[0]).toBe("REPLACE_WITH_PLAY_APP_SIGNING_SHA256");
    expect(fingerprints[0]).not.toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2})+$/);
  });

  it("serves both link manifests on the short edge window a fingerprint needs", () => {
    // A statement file the edge holds for a year is a statement file the
    // weekend's real fingerprint cannot reach. Both manifests take the same
    // short window, and both are declared as JSON.
    const config = rootFile("next.config.mjs");
    for (const manifest of [
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
    ]) {
      // The rule is the source line and its own headers array, up to the
      // closing bracket of that array — `split("},")` cuts inside it.
      const from = config.indexOf(`source: "${manifest}"`);
      expect(from, manifest).toBeGreaterThan(-1);
      const rule = config.slice(from, config.indexOf("],", from));
      expect(rule, manifest).toContain("SHORT_EDGE_PUBLIC_ASSET_CACHE_CONTROL");
      expect(rule, manifest).toContain('value: "application/json"');
    }
  });

  it("declares the runtime notification permission Android 13 made mandatory", () => {
    // Undeclared, the request lib/nativePush.ts makes cannot be granted: no
    // dialog, no token, no error anybody would ever see. Declaring it asks for
    // nothing on its own - the contextual explainer is still the only thing
    // that raises the OS dialog, and only after a kept action.
    const manifest = rootFile("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
  });

  it("keeps store identity, Android toolchain, and location answers truthful", () => {
    const readiness = rootFile("docs/STORE_READINESS.md");
    expect(readiness).toContain("Create the app record in App Store Connect: name PUBMAXXING");
    expect(readiness).toContain("Create the app in the Play Console: name PUBMAXXING");
    expect(readiness).toContain("JDK 21");
    expect(readiness).toContain("Precise location");
    expect(readiness).toContain("ephemeral");
    expect(readiness).not.toContain("Location is never transmitted to the server");
    expect(readiness).not.toContain("Coordinates are never sent to our servers");
    expect(readiness).not.toContain("Location: Not collected (processed on-device only)");
  });
});
