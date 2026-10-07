// @vitest-environment jsdom

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import capacitorConfig, { nativeServerUrl } from "../capacitor.config";
import { APP_NAME } from "@/lib/brandNaming";
import { BRAND_COLORS } from "@/lib/brandMark.mjs";
import {
  NATIVE_DEEP_LINK_EXACT_PATHS,
  NATIVE_DEEP_LINK_PATH_PREFIXES,
  NATIVE_URL_SCHEME,
} from "@/lib/nativeDeepLinks";

const rootFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const javaFilesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javaFilesUnder(path);
    return entry.isFile() && entry.name.endsWith(".java") ? [path] : [];
  });

const androidJavaTests = (sourceSet: "androidTest" | "test") => {
  const sourceRoot = join(process.cwd(), "android/app/src", sourceSet, "java");
  return javaFilesUnder(sourceRoot).map((testFile) => ({ sourceRoot, testFile }));
};

const xmlDocument = (path: string) =>
  new DOMParser().parseFromString(rootFile(path), "application/xml");

type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

/** One XML plist element as the value it declares. */
function plistValue(element: Element): PlistValue {
  const children = [...element.children];
  switch (element.tagName) {
    case "dict":
      return Object.fromEntries(
        children.flatMap((child, index) =>
          child.tagName === "key" && children[index + 1]
            ? [[child.textContent ?? "", plistValue(children[index + 1] as Element)]]
            : [],
        ),
      );
    case "array":
      return children.map(plistValue);
    case "integer":
    case "real":
      return Number(element.textContent);
    case "true":
      return true;
    case "false":
      return false;
    default:
      return element.textContent ?? "";
  }
}

function plistRoot(path: string): Record<string, PlistValue> {
  const dict = xmlDocument(path).querySelector("plist > dict");
  if (!dict) throw new Error(`${path} has no root dict`);
  return plistValue(dict) as Record<string, PlistValue>;
}

type PbxValue = string | PbxValue[] | PbxDict;
type PbxDict = { [key: string]: PbxValue };

/** An old-style ASCII plist such as project.pbxproj, as the value it declares. */
function pbxprojRoot(path: string): PbxDict {
  const tokens = (
    rootFile(path).match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|[{}()=;,]|[^\s{}()=;,"]+/g) ?? []
  ).filter((token) => !token.startsWith("/*") && !token.startsWith("//"));
  let at = 0;
  const expectToken = (want: string) => {
    if (tokens[at++] !== want) throw new Error(`${path}: expected "${want}" at token ${at - 1}`);
  };
  const value = (): PbxValue => {
    const token = tokens[at++];
    if (token === undefined) throw new Error(`${path}: ended early`);
    if (token === "{") {
      const dict: PbxDict = {};
      while (tokens[at] !== "}") {
        const key = value() as string;
        expectToken("=");
        dict[key] = value();
        expectToken(";");
      }
      at++;
      return dict;
    }
    if (token === "(") {
      const list: PbxValue[] = [];
      while (tokens[at] !== ")") {
        list.push(value());
        if (tokens[at] === ",") at++;
      }
      at++;
      return list;
    }
    return token.startsWith('"') ? (JSON.parse(token) as string) : token;
  };
  return value() as PbxDict;
}

const ANDROID_RES = join(process.cwd(), "android/app/src/main/res");

/** Every XML resource under android/app/src/main/res, path relative to it. */
function androidResourceXml(dir = ANDROID_RES, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return androidResourceXml(join(dir, entry.name), name);
    return entry.name.endsWith(".xml") ? [name] : [];
  });
}

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

  it("keeps Android test identities aligned with the application id", () => {
    const build = rootFile("android/app/build.gradle");
    const applicationId = build.match(/applicationId\s+"([^"]+)"/)?.[1];
    expect(applicationId).toBe("com.pubmaxx.app");

    for (const { sourceRoot, testFile } of [
      ...androidJavaTests("androidTest"),
      ...androidJavaTests("test"),
    ]) {
      const source = readFileSync(testFile, "utf8");
      const packageName = source.match(/^package\s+([\w.]+);/m)?.[1];
      const packagePath = relative(sourceRoot, dirname(testFile)).split(sep).join(".");

      expect(
        packageName === applicationId || packageName?.startsWith(`${applicationId}.`),
        testFile,
      ).toBe(true);
      expect(packagePath, testFile).toBe(packageName);

      if (source.includes("getTargetContext()")) {
        const expectedContextPackage = source.match(
          /assertEquals\("([^"]+)",\s*appContext\.getPackageName\(\)\)/,
        )?.[1];
        expect(expectedContextPackage, testFile).toBe(applicationId);
      }
    }
  });

  it("loads production remotely and has a bundled, truthful outage fallback", () => {
    expect(capacitorConfig.webDir).toBe("native/web-stub");
    expect(capacitorConfig.server?.url).toBe("https://pubmaxxing.com/");
    expect(capacitorConfig.server?.cleartext).not.toBe(true);
    expect(capacitorConfig.server?.errorPath).toBe("offline.html");

    const offline = rootFile("native/web-stub/offline.html");
    expect(offline).toContain("Nothing stale is being shown.");
    expect(offline).toContain("prefers-color-scheme: dark");
    expect(offline).toContain("env(safe-area-inset-top, 0px)");
    expect(offline).toContain("https://pubmaxxing.com");
  });

  it("carries the launch field behind the WebView, so no white frame stands between them", () => {
    // WKWebView draws UIColor.systemBackground — WHITE in light appearance —
    // until the page paints, and Capacitor holds it non-opaque for the whole
    // initial load (WebViewDelegationHandler). Measured on the iPhone 17 Pro
    // simulator against a local production build on 7 September 2026: the ink
    // launch screen ended at 1601ms, the screen was PURE white (one colour over
    // the whole frame) from 2140ms to 4507ms, and content arrived at 5550ms.
    // Three fields in five seconds, the middle one belonging to no design.
    //
    // The field is the launch screen's own, read from the same constant
    // scripts/gen-native-app-icons.mjs cuts LaunchBackground.colorset from, so
    // the two cannot drift and the app opens on ONE colour.
    expect(capacitorConfig.ios?.backgroundColor).toBe(BRAND_COLORS.inkDeep);
    // ANDROID STILL HAS A WHITE FRAME AND THIS IS NOT ITS REMEDY. Two were
    // measured out on the API 36 emulator on 7 September 2026 and both are
    // written down in capacitor.config.ts so the next pass does not spend them
    // again. This fence holds the config to the one that is proven, and holds
    // Android to NOT carrying a setting that was proven to do nothing.
    expect(capacitorConfig.android?.backgroundColor).toBeUndefined();
    expect(capacitorConfig.backgroundColor).toBeUndefined();

    const launchField = rootFile(
      "ios/App/App/Assets.xcassets/LaunchBackground.colorset/Contents.json",
    );
    const hex = BRAND_COLORS.inkDeep.replace("#", "").toUpperCase();
    expect(launchField).toContain(`"red": "0x${hex.slice(0, 2)}"`);
    expect(launchField).toContain(`"green": "0x${hex.slice(2, 4)}"`);
    expect(launchField).toContain(`"blue": "0x${hex.slice(4, 6)}"`);
  });

  it("takes a local origin only from the review variable, and never ships one", () => {
    // The unset case above is what every CI and store build sees. A rig
    // reviewing a checkout sets PUBMAX_NATIVE_SERVER_URL at sync time, and
    // cleartext follows the scheme rather than being a second switch.
    expect(nativeServerUrl({})).toBe("https://pubmaxxing.com/");
    expect(nativeServerUrl({ PUBMAX_NATIVE_SERVER_URL: "   " })).toBe("https://pubmaxxing.com/");
    expect(nativeServerUrl({ PUBMAX_NATIVE_SERVER_URL: "http://10.0.2.2:3811" })).toBe(
      "http://10.0.2.2:3811",
    );
    // The committed config must be the production one: the generated
    // capacitor.config.json files are untracked, so this is the only copy a
    // reviewer can read.
    const source = rootFile("capacitor.config.ts");
    expect(source).toContain('PRODUCTION_SERVER_URL = "https://pubmaxxing.com/"');
    expect(source).toContain('serverUrl.startsWith("http://") ? { cleartext: true }');
  });

  it("keeps system bars visible and enables Capacitor safe-area correction", () => {
    expect(capacitorConfig.plugins?.SystemBars).toEqual({
      hidden: false,
      style: "DEFAULT",
      insetsHandling: "css",
    });
  });

  it("preserves iOS camera permissions, APNs forwarding, and the App plugin", () => {
    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain("NSCameraUsageDescription");
    expect(info).toContain("NSPhotoLibraryUsageDescription");
    expect(info).not.toContain("NSPhotoLibraryAddUsageDescription");

    const delegate = rootFile("ios/App/App/AppDelegate.swift");
    expect(delegate).toContain("capacitorDidRegisterForRemoteNotifications");
    expect(delegate).toContain("capacitorDidFailToRegisterForRemoteNotifications");

    expect(rootFile("ios/App/CapApp-SPM/Package.swift")).toContain("CapacitorApp");
    expect(rootFile("android/app/capacitor.build.gradle")).toContain(
      "implementation project(':capacitor-app')",
    );
  });

  it("adopts the UIScene lifecycle that iOS 27 requires", () => {
    // iOS 27 refuses an app with no scene manifest: a free personal-team build
    // on an iPhone 17 Pro Max (iOS 27.2) died at launch with EXC_BREAKPOINT in
    // UIKitCore ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption.
    // The iOS 27.0 simulator does not enforce it, so a simulator launch cannot
    // catch this; the source has to. The shape is Capacitor 8.5's own
    // (`npx cap migrate`): one scene, built from Main.storyboard, whose delegate
    // is the module's SceneDelegate.
    const info = plistRoot("ios/App/App/Info.plist");
    expect(info.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
            UISceneStoryboardFile: "Main",
          },
        ],
      },
    });

    // The storyboard the manifest names opens on the Capacitor bridge.
    const storyboard = xmlDocument("ios/App/App/Base.lproj/Main.storyboard");
    const initialId = storyboard.documentElement.getAttribute("initialViewController");
    const initial = storyboard.querySelector(`[id="${initialId}"]`);
    expect(initial?.getAttribute("customClass")).toBe("CAPBridgeViewController");
    expect(initial?.getAttribute("customModule")).toBe("Capacitor");

    // The SceneDelegate the manifest names is compiled into the App target.
    const objects = pbxprojRoot("ios/App/App.xcodeproj/project.pbxproj").objects as PbxDict;
    const object = (id: PbxValue | undefined) => objects[id as string] as PbxDict;
    const app = Object.values(objects).find(
      (entry) => (entry as PbxDict).isa === "PBXNativeTarget" && (entry as PbxDict).name === "App",
    ) as PbxDict;
    const sources = (app.buildPhases as PbxValue[])
      .map(object)
      .find((phase) => phase.isa === "PBXSourcesBuildPhase");
    const compiled = (sources?.files as PbxValue[]).map(
      (buildFile) => object(object(buildFile).fileRef).path,
    );
    expect(compiled).toContain("SceneDelegate.swift");
  });

  it("answers export compliance in the build, not by hand on every upload", () => {
    // Absent this key App Store Connect marks EVERY uploaded build "Missing
    // Compliance" and holds it out of TestFlight and review until somebody
    // answers the question by hand, once per upload. The honest answer is
    // false: the app carries no encryption of its own and only ever talks
    // HTTPS, which is the exempt case. A `<true/>` here would be a different
    // claim entirely and would pull in the export paperwork, so the fence
    // reads the VALUE rather than the key's presence.
    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain(
      "<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>",
    );
  });

  it("offers iPhone one orientation, and the same one the web manifest offers", () => {
    // Landscape was opted into and hands the reader a layout nobody tests: at
    // 844x390 the app crosses into the DESKTOP layout, where the desktop nav
    // bar and map toolbar take roughly 55% of the height and the phone sheet
    // shell does not mount at all, so a pin tap behaves differently from
    // portrait. The manifest already declared portrait-primary, so the two
    // halves of one answer disagreed and the plist was the half a reviewer
    // acts on. iPad is a separate key and is deliberately untouched.
    const info = rootFile("ios/App/App/Info.plist");
    const start = info.indexOf("<key>UISupportedInterfaceOrientations</key>");
    const iphone = info.slice(start, info.indexOf("</array>", start));
    expect(iphone).toContain("<string>UIInterfaceOrientationPortrait</string>");
    expect(iphone).not.toContain("Landscape");
    expect(iphone).not.toContain("PortraitUpsideDown");
    const manifest = JSON.parse(rootFile("public/manifest.webmanifest")) as {
      orientation?: string;
    };
    expect(manifest.orientation).toBe("portrait-primary");

    // v1 is iPhone only (firstmate decision, 7 September 2026): a universal
    // binary makes App Store Connect demand 13-inch screenshots and sends
    // reviewers into the untested desktop class. So the device family is 1 on
    // both configurations and the plist carries no iPad orientation key; iPad
    // is a later release with its own layout pass. Android says the same
    // through the documented Play screen filter.
    expect(info).not.toContain("~ipad");
    const project = rootFile("ios/App/App.xcodeproj/project.pbxproj");
    expect(project.match(/TARGETED_DEVICE_FAMILY = 1;/g)?.length).toBe(2);
    expect(project).not.toContain('TARGETED_DEVICE_FAMILY = "1,2"');
    const androidManifest = rootFile("android/app/src/main/AndroidManifest.xml");
    expect(androidManifest).toContain("<supports-screens");
    expect(androidManifest).toContain('android:largeScreens="false"');
    expect(androidManifest).toContain('android:xlargeScreens="false"');
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
      `<string>${APP_NAME} uses the camera so you can photograph a price board, a pub, or your own night.</string>`,
    );
    expect(info).toContain(
      `<string>${APP_NAME} uses your location while the app is open to find nearby pubs and calculate walk times.</string>`,
    );
    expect(info).toContain(
      `<string>${APP_NAME} opens your photo library so you can choose a photo you have already taken.</string>`,
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

  it("registers the pubmaxx:// scheme in both shells, as a fallback beside the verified links", () => {
    // D20, 13 Sep 2026 audit: `xcrun simctl openurl <udid> pubmaxx://...`
    // failed with LSApplicationWorkspaceErrorDomain error 115, because neither
    // shell registered the scheme. Universal links and App Links stay the
    // intended path and need a signed build to test; the scheme is what a rig
    // can open today. The families it opens are lib/nativeDeepLinks.ts's own.
    const info = plistRoot("ios/App/App/Info.plist");
    expect(info.CFBundleURLTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          CFBundleURLName: "com.pubmaxx.app",
          CFBundleURLSchemes: expect.arrayContaining([NATIVE_URL_SCHEME]),
        }),
      ]),
    );

    const manifest = xmlDocument("android/app/src/main/AndroidManifest.xml");
    const mainActivity = [...manifest.getElementsByTagName("activity")].find(
      (activity) => activity.getAttribute("android:name") === ".MainActivity",
    );
    expect(mainActivity, "AndroidManifest.xml has no .MainActivity").toBeDefined();
    const schemeFilters = [...(mainActivity?.getElementsByTagName("intent-filter") ?? [])].filter(
      (filter) =>
        [...filter.getElementsByTagName("data")].some(
          (data) => data.getAttribute("android:scheme") === NATIVE_URL_SCHEME,
        ),
    );
    expect(schemeFilters).toHaveLength(1);
    const [filter] = schemeFilters;
    const names = (tag: string) =>
      [...(filter?.getElementsByTagName(tag) ?? [])].map((node) => node.getAttribute("android:name"));
    expect(names("action")).toContain("android.intent.action.VIEW");
    expect(names("category")).toEqual(
      expect.arrayContaining(["android.intent.category.DEFAULT", "android.intent.category.BROWSABLE"]),
    );
    // A plain filter, never an autoVerify one: verification belongs to the
    // https families, and their count is held by the test above.
    expect(filter?.getAttribute("android:autoVerify")).toBeNull();
    for (const data of filter?.getElementsByTagName("data") ?? []) {
      expect(data.hasAttribute("android:host")).toBe(false);
    }
  });

  it("requires the architecture the platform actually has", () => {
    // `armv7` was a Capacitor template leftover: a 32-bit capability on a
    // platform that has been 64-bit only since iOS 11, naming a device class
    // this app cannot ship to.
    // Read the ARRAY, not the file: the plist comment beside it names the
    // retired value on purpose, so a whole-file search would fail on the
    // explanation rather than on a capability.
    const info = rootFile("ios/App/App/Info.plist");
    const capabilities = info.slice(
      info.indexOf("<key>UIRequiredDeviceCapabilities</key>"),
      info.indexOf("<key>UISupportedInterfaceOrientations</key>"),
    );
    expect(capabilities).toContain("<string>arm64</string>");
    expect(capabilities).not.toContain("armv7");
  });

  it("lets iOS save and fill the password this app now offers", () => {
    // The handle + password sign-in exists (components/auth/SetAccountPassword.tsx,
    // /api/auth/handle-password) and the associated-domains agreement carried
    // only `applinks`, so the keychain never learned the password existed and
    // a person who set one had to type it every time. `webcredentials` is the
    // second service on that agreement, and like `applinks` it is TWO halves:
    // the entitlement the app carries and the block the site publishes. One
    // half alone does nothing and says nothing.
    const entitlements = rootFile("ios/App/App/App.entitlements");
    expect(entitlements).toContain("<string>applinks:pubmaxxing.com</string>");
    expect(entitlements).toContain("<string>webcredentials:pubmaxxing.com</string>");

    const aasa = JSON.parse(
      rootFile("public/.well-known/apple-app-site-association"),
    ) as {
      applinks: { details: Array<{ appIDs: string[] }> };
      webcredentials?: { apps?: string[] };
    };
    // One app, named the same way in both blocks: a webcredentials entry for a
    // different appID would publish the password domain to nothing.
    expect(aasa.webcredentials?.apps).toEqual(aasa.applinks.details[0]?.appIDs);
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

  it("paints Android chrome in the brand rather than Capacitor's Material defaults", () => {
    // styles.xml has always referenced these three names, and the app shipped
    // no colors.xml, so they resolved to the ones Capacitor's own library
    // ships: Material indigo and pink. They paint the recents-screen task card
    // and the WebView's text-selection handles, which is the first and last
    // chrome a reviewer swiping the task switcher sees.
    //
    // The values are READ from lib/brandMark.mjs, the master the icons and the
    // share cards are cut from, rather than restated here: a fence that typed
    // the hex out would only ever prove itself right.
    const styles = rootFile("android/app/src/main/res/values/styles.xml");
    for (const name of ["colorPrimary", "colorPrimaryDark", "colorAccent"]) {
      expect(styles, name).toContain(`<item name="${name}">@color/${name}</item>`);
    }

    const colors = rootFile("android/app/src/main/res/values/colors.xml");
    expect(colors).toContain(
      `<color name="colorPrimary">${BRAND_COLORS.inkDeep}</color>`,
    );
    expect(colors).toContain(
      `<color name="colorPrimaryDark">${BRAND_COLORS.inkDeep}</color>`,
    );
    expect(colors).toContain(
      `<color name="colorAccent">${BRAND_COLORS.coral}</color>`,
    );
  });

  it("keeps every Android resource comment legal, because aapt fails the build", () => {
    // XML forbids a double hyphen inside a comment, and aapt refuses the WHOLE
    // build for one: `mergeDebugResources` fails with "The string "--" is not
    // permitted within comments" and names one line. Nothing in the TypeScript
    // suite reads these files as XML, so the first thing that ever said so was
    // a Gradle run - which is exactly the Android-half asymmetry this project
    // already knows about. Writing a CSS custom property by name is the easy
    // way in, and it is how values/colors.xml first turned the build red.
    const files = androidResourceXml();
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const bodies = [
        ...readFileSync(join(ANDROID_RES, name), "utf8").matchAll(/<!--([\s\S]*?)-->/g),
      ].map((match) => match[1] ?? "");
      for (const body of bodies) {
        expect(`${name}: ${body.includes("--") ? "illegal -- in comment" : "ok"}`).toBe(
          `${name}: ok`,
        );
      }
    }
  });

  it("keeps the WebView's auth storage out of the person's Google Drive", () => {
    // Android Auto Backup is ON by default and copies WebView localStorage to
    // Drive. This app keeps the browser session there (lib/authSessionResume.ts)
    // and a refresh token per account beside it (lib/deviceAccountSessions.ts),
    // so the Capacitor default backed up live credentials to a third-party
    // cloud that neither app/privacy/page.tsx nor the Play Data safety form
    // describes. The same attribute governs Android 12+ device-to-device
    // transfer, which is why no extraction-rules file is needed: refusing is
    // one line and it closes both doors.
    const manifest = rootFile("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).not.toContain('android:allowBackup="true"');
    // A rules file would mean backup was KEPT in some form, and then the
    // privacy notice and the Data safety answers would have to say so in the
    // same commit. Neither exists, and neither should appear without that.
    expect(manifest).not.toContain("android:dataExtractionRules");
    expect(manifest).not.toContain("android:fullBackupContent");
  });

  it("declares the runtime notification permission Android 13 made mandatory", () => {
    // Undeclared, the request lib/nativePush.ts makes cannot be granted: no
    // dialog, no token, no error anybody would ever see. Declaring it asks for
    // nothing on its own - the contextual explainer is still the only thing
    // that raises the OS dialog, and only after a kept action.
    const manifest = rootFile("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
  });

  it("labels the offline retry the way every other control in the app is labelled", () => {
    // ONE CONTROL IN THE WHOLE SHELL ENDED ITS LABEL IN A FULL STOP. The app's
    // own retries are "Retry" and "Try again"; the bundled offline page said
    // "Try again.". Seen on the API 36 emulator in airplane mode on
    // 7 September 2026 (docs/proof/mobile-shells-refresh/). Sentences take a
    // full stop here and labels do not, and the outage page is the one screen a
    // reader meets with nothing else of ours on it to compare against.
    const offline = rootFile("native/web-stub/offline.html");
    expect(offline).toContain(">Try again<");
    expect(offline).not.toContain(">Try again.<");
    // The heading beside it is a sentence and keeps its full stop.
    expect(offline).toContain("<h1>Nothing to show yet.</h1>");
  });

  it("names the origin the rig actually loaded, not the one it usually loads", () => {
    // THE LINE THAT TOLD THE OPERATOR HE WAS LOOKING AT PRODUCTION.
    // `PUBMAX_NATIVE_SERVER_URL` points a rig at a local build, and both run
    // scripts still printed the production origin at the end of a launch. An
    // operator reading that line believes a checkout under review is what has
    // shipped, which is the exact confusion this pass was opened to clear: the
    // captain reported "still the old version" while looking at a stale build.
    for (const script of [
      "scripts/ios-simulator.mjs",
      "scripts/android/run.mjs",
    ]) {
      const source = rootFile(script);
      expect(source).not.toContain("The shell loads https://pubmaxxing.com");
      // The origin is read back out of the config `npx cap sync` GENERATED for
      // this platform, which is the artefact the built app actually carries.
      // A second copy of the fallback constant here would be one more place
      // for the shipped origin to drift from what the operator is told.
      expect(source).toContain("capacitor.config.json");
      expect(source).toContain("syncedServerUrl");
    }
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
    // The iOS app icon already IS the store master, byte for byte, and section 7
    // used to send the next reader off to redo that. A readiness pack that asks
    // for finished work costs a step somebody will spend looking for it.
    expect(readiness).not.toContain("at the next native pass");
  });
});
