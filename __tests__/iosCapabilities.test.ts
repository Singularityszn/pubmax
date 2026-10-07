// @vitest-environment jsdom

// The two capabilities the shell cannot work without, and the manifest Apple
// reads before it accepts a build.
//
// Both are FILES, not code, and both fail silently when they are missing: with
// no `aps-environment` the device never gets an APNs token and no error is
// raised anywhere a person or a log would see it, and with no associated
// domain a shared pubmaxxing.com link opens Safari beside the installed app.
// Neither is reproducible without a signed device, so the fence is the project.
//
// Everything here is checked in and needs no Apple account. The one thing that
// still waits for enrolment is the Team ID, and it waits in exactly one place:
// the TEAMID placeholder in the association file.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plistRoot, type PlistValue } from "@/__tests__/helpers/plist";
import { pbxprojRoot, type PbxDict, type PbxValue } from "@/__tests__/helpers/pbxproj";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const ENTITLEMENTS = "ios/App/App/App.entitlements";
const PROJECT = "ios/App/App.xcodeproj/project.pbxproj";
const MANIFEST = "ios/App/App/PrivacyInfo.xcprivacy";

describe("the iOS project declares its capabilities", () => {
  const entitlements = read(ENTITLEMENTS);
  const project = read(PROJECT);

  it("asks for push, and for the environment a device build registers against", () => {
    expect(entitlements).toContain("<key>aps-environment</key>");
    // `development` is what a development-signed build needs; Xcode rewrites
    // it to production when the archive is distributed. A file that says
    // production would leave a TestFlight device unable to register at all.
    expect(entitlements).toContain("<string>development</string>");
  });

  it("asks for both services on the one associated domain the app routes", () => {
    expect(entitlements).toContain("com.apple.developer.associated-domains");
    expect(entitlements).toContain("applinks:pubmaxxing.com");
    // This used to refuse `webcredentials` on the grounds that the app had no
    // password to autofill. It has one now (components/auth/SetAccountPassword.tsx
    // and /api/auth/handle-password), so refusing it means the keychain never
    // learns the password exists and a person who set one types it every time.
    // Both services ride one domain and one agreement; the site's half is the
    // `webcredentials` block in the AASA, held to this one in
    // __tests__/nativeWrap.test.ts.
    expect(entitlements).toContain("webcredentials:pubmaxxing.com");
    // Still one domain. An entitlement for a host this app does not serve is a
    // thing review can ask about and nothing can answer.
    const domains = [...entitlements.matchAll(/<string>(applinks|webcredentials):([^<]+)<\/string>/g)];
    expect(new Set(domains.map((match) => match[2]))).toEqual(
      new Set(["pubmaxxing.com"]),
    );
  });

  it("points both build configurations at the entitlements file", () => {
    const settings = [...project.matchAll(/CODE_SIGN_ENTITLEMENTS = ([^;]+);/g)].map(
      (match) => match[1],
    );
    // Debug and Release. One alone means the capability silently disappears in
    // whichever configuration was missed, which is usually the archive.
    expect(settings).toEqual(["App/App.entitlements", "App/App.entitlements"]);
  });

  it("keeps the file visible in the project, not only in a build setting", () => {
    expect(project).toContain("/* App.entitlements */ = {isa = PBXFileReference;");
  });

  it("leaves the Team ID as the one placeholder enrolment fills in", () => {
    const association = read("public/.well-known/apple-app-site-association");
    expect(association).toContain("TEAMID.com.pubmaxx.app");
    // The entitlement side carries no team id at all: Xcode derives it from
    // the signing team, so there is nothing here to forget to update.
    expect(entitlements).not.toContain("TEAMID");
  });
});

describe("the privacy manifest agrees with the answers we publish", () => {
  const manifest = plistRoot(MANIFEST);
  const readiness = read("docs/STORE_READINESS.md");

  const APP_FUNCTIONALITY = "NSPrivacyCollectedDataTypePurposeAppFunctionality";
  const ANALYTICS = "NSPrivacyCollectedDataTypePurposeAnalytics";

  /** The six things section 5 says the app collects, in the App Privacy label's order. */
  const DECLARED = [
    { type: "NSPrivacyCollectedDataTypeEmailAddress", linked: true, tracking: false, purposes: [APP_FUNCTIONALITY] },
    { type: "NSPrivacyCollectedDataTypePhotosorVideos", linked: true, tracking: false, purposes: [APP_FUNCTIONALITY] },
    { type: "NSPrivacyCollectedDataTypeAudioData", linked: true, tracking: false, purposes: [APP_FUNCTIONALITY] },
    { type: "NSPrivacyCollectedDataTypeDeviceID", linked: false, tracking: false, purposes: [APP_FUNCTIONALITY] },
    { type: "NSPrivacyCollectedDataTypeProductInteraction", linked: false, tracking: false, purposes: [ANALYTICS] },
    { type: "NSPrivacyCollectedDataTypePreciseLocation", linked: false, tracking: false, purposes: [APP_FUNCTIONALITY] },
  ];

  const collected = (manifest.NSPrivacyCollectedDataTypes as Array<Record<string, PlistValue>>).map(
    (entry) => ({
      type: entry.NSPrivacyCollectedDataType,
      linked: entry.NSPrivacyCollectedDataTypeLinked,
      tracking: entry.NSPrivacyCollectedDataTypeTracking,
      purposes: entry.NSPrivacyCollectedDataTypePurposes,
    }),
  );

  it("declares each collected type once, with its answers, and nothing else", () => {
    expect(collected).toEqual(DECLARED);
  });

  it("says the app tracks nobody, in both places that can say it", () => {
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
    expect(collected.filter((entry) => entry.tracking !== false)).toEqual([]);
    // The doc has to be able to say the same thing.
    expect(readiness).toContain("**Data Used to Track You:** None.");
  });

  it("keeps analytics the only thing collected for analytics", () => {
    const analytics = collected.filter(
      (entry) => Array.isArray(entry.purposes) && entry.purposes.includes(ANALYTICS),
    );
    expect(analytics.map((entry) => entry.type)).toEqual([
      "NSPrivacyCollectedDataTypeProductInteraction",
    ]);
  });

  it("speaks only for the app target's own code", () => {
    // The AppDelegate, the SceneDelegate and two storyboards call no
    // required-reason API.
    // Capacitor declares its own in its own package, and a manifest may only
    // speak for the code it ships with.
    expect(manifest.NSPrivacyAccessedAPITypes).toEqual([]);
  });

  it("is copied into the bundle, not just present in the tree", () => {
    const project = pbxprojRoot(PROJECT);
    const objects = project.objects as PbxDict;
    const object = (id: PbxValue | undefined): PbxDict => {
      if (typeof id !== "string") throw new Error("Expected a PBX object reference");
      const referenced = objects[id];
      if (typeof referenced !== "object" || Array.isArray(referenced)) {
        throw new Error(`Expected a PBX object for ${id}`);
      }
      return referenced;
    };
    const targets = object(project.rootObject).targets as PbxValue[];
    const app = targets.map(object).find(
      (target) => target.isa === "PBXNativeTarget" && target.name === "App",
    );
    expect(app).toBeDefined();
    const resources = (app!.buildPhases as PbxValue[])
      .map(object)
      .filter((phase) => phase.isa === "PBXResourcesBuildPhase")
      .flatMap((phase) => (phase.files as PbxValue[]).map(object))
      .filter((file) => file.isa === "PBXBuildFile")
      .map((file) => object(file.fileRef))
      .filter((file) => file.isa === "PBXFileReference")
      .map((file) => file.path);
    expect(resources).toContain("PrivacyInfo.xcprivacy");
  });
});

describe("the weekend checklist matches the repository it describes", () => {
  const readiness = read("docs/STORE_READINESS.md");

  it("names all four APNs values, because a partial set sends nothing", () => {
    for (const key of ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_PRIVATE_KEY", "APNS_ENV"]) {
      expect(readiness, key).toContain(key);
    }
  });

  it("tells the owner the capabilities are already declared", () => {
    // Adding one by hand in Xcode writes a second entitlements file, and the
    // two then disagree about what the app asks for.
    expect(readiness).toContain("App.entitlements");
    expect(readiness).toContain("Do not add them by hand");
  });

  it("keeps the submission gate on the three superpowers", () => {
    expect(readiness).toContain("thin-wrapper rejection");
    for (const proof of ["**Camera.**", "**Push.**", "**Universal links.**"]) {
      expect(readiness, proof).toContain(proof);
    }
  });

  it("points at screenshot folders that exist", () => {
    for (const size of ["ios-6.7", "ios-6.5"]) {
      expect(readiness, size).toContain(`public/store-assets/screenshots/${size}`);
      expect(() =>
        read(`public/store-assets/screenshots/${size}/manifest.json`),
      ).not.toThrow();
    }
  });

  it("warns that the Team ID edit breaks this file's own placeholder test", () => {
    // Step 3 changes the value __tests__/iosCapabilities.test.ts asserts. A
    // checklist that leaves the owner with a red suite on Saturday morning is
    // a checklist that gets abandoned halfway.
    expect(readiness).toContain("__tests__/iosCapabilities.test.ts");
  });
});
