// The Android half of push, which is data and Gradle rather than TypeScript.
//
// `lib/nativePush.ts` is platform-neutral and already tested: it asks, it
// registers, it POSTs the token with its platform, it routes a tap. What
// decides whether any of that can HAPPEN on Android is three things this file
// pins, because every one of them fails silently.
//
// A binary built with no google-services.json installs, runs, and answers every
// registration with `registrationError`. A real google-services.json committed
// by accident publishes somebody's Firebase project. And the server can only
// send to a device once all four FCM values are set, which is a deployment step
// rather than a build one.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import capacitorConfig from "../capacitor.config";
import { validatePushToken } from "@/lib/pushTokenStore";

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

describe("the Firebase config is a weekend step, not a committed secret", () => {
  it("keeps the real file out of the repository", () => {
    expect(existsSync(join(ROOT, "android/app/google-services.json"))).toBe(false);
    // Absent is not the same as ignored: a file nobody has generated yet is
    // absent today and committed the first time somebody does generate one.
    expect(read("android/app/.gitignore")).toContain("google-services.json");
  });

  it("ships a placeholder that names the account it needs and holds no values", () => {
    const example = read("android/app/google-services.json.example");
    const parsed = JSON.parse(example) as {
      project_info: { project_id: string };
      client: Array<{ client_info: { android_client_info: { package_name: string } } }>;
    };
    // Same binary as everything else names.
    expect(parsed.client[0]?.client_info.android_client_info.package_name).toBe(
      capacitorConfig.appId,
    );
    // Every value is an obvious placeholder, so a half-filled file cannot be
    // mistaken for a working one.
    expect(parsed.project_info.project_id).toMatch(/^REPLACE_WITH_/);
    expect(example).toContain("console.firebase.google.com");
    expect(example).toContain("Do not commit it");
    // The service-account key is the server's half and never the app's.
    expect(example).toContain("Never put it in the repository or in the app");
  });
});

describe("a build with no Firebase says so instead of looking complete", () => {
  const gradle = read("android/app/build.gradle");

  it("reports the skip at a level somebody actually sees", () => {
    // Capacitor generates this as `logger.info`, which prints at no default log
    // level, so the one record of why push is dead was invisible.
    expect(gradle).toContain("logger.lifecycle");
    expect(gradle).not.toContain("logger.info(");
  });

  it("still builds without it, because push is one feature and not the app", () => {
    expect(gradle).toContain("googleServices.exists()");
    expect(gradle).toContain("apply plugin: 'com.google.gms.google-services'");
  });

  it("carries the plugin on the classpath so a real config takes effect", () => {
    expect(read("android/build.gradle")).toContain("com.google.gms:google-services");
  });
});

describe("the token path knows Android is its own platform", () => {
  it("accepts an android registration and keeps its platform", () => {
    const parsed = validatePushToken({ token: "fcm-registration-token", platform: "android" });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.input.platform).toBe("android");
  });

  it("routes android to FCM rather than letting it fall through to APNs", () => {
    // A platform that fell through would send an FCM registration token to
    // Apple for ever, and every send would fail in a way that looks like a bad
    // device rather than a bad route.
    expect(read("lib/pushProvider.ts")).toContain("fcmPushProvider");
  });

  it("names all four server values, so a partial deployment cannot half-send", () => {
    const fcm = read("lib/fcmPushProvider.ts");
    for (const key of [
      "FCM_PROJECT_ID",
      "FCM_CLIENT_EMAIL",
      "FCM_PRIVATE_KEY_ID",
      "FCM_PRIVATE_KEY",
    ]) {
      expect(fcm, key).toContain(key);
      expect(read(".env.example"), key).toContain(key);
    }
  });

  it("declares the runtime permission the request depends on", () => {
    // Android 13 made this mandatory. Undeclared, lib/nativePush.ts asks for
    // something that can never be granted: no dialog, no token, no error.
    expect(read("android/app/src/main/AndroidManifest.xml")).toContain(
      "android.permission.POST_NOTIFICATIONS",
    );
  });
});
