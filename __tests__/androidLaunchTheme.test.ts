// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND_COLORS } from "@/lib/brandMark.mjs";

// THE ANDROID LAUNCH IS DRAWN BY THE OS FROM THE THEME, AND THE THEME SAID
// NOTHING. Measured on a Pixel 7 API 36 emulator
// (docs/proof/mobile-app-design/android-emu-pixel7/launch/): the Android 12+
// system splash painted the launcher icon in its white disc on a light
// Material grey, because drawable/splash.png is only the window background
// AFTER the system splash and the SplashScreen theme carried none of its own
// values; and on a WebView older than the version Capacitor trusts to report
// safe areas the WebView is inset from the system bars and the theme's white
// windowBackground showed as a band under the clock over an off-white page.
// Both are theme values, so both are held here.
const ROOT = join(__dirname, "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const STYLES = "android/app/src/main/res/values/styles.xml";
const COLORS = "android/app/src/main/res/values/colors.xml";
const NIGHT_COLORS = "android/app/src/main/res/values-night/colors.xml";
const SPLASH_MARK = "android/app/src/main/res/drawable/ic_splash_mark.xml";
const ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android";

function xml(file: string): Document {
  const document = new DOMParser().parseFromString(read(file), "application/xml");
  expect(document.getElementsByTagName("parsererror"), file).toHaveLength(0);
  return document;
}

function styleItems(styles: Document, name: string): Record<string, string> {
  const style = styles.querySelector(`resources > style[name="${name}"]`);
  expect(style, name).not.toBeNull();
  return Object.fromEntries(
    Array.from(style!.querySelectorAll(":scope > item"), (item) => [
      item.getAttribute("name"),
      item.textContent?.trim() ?? "",
    ]),
  );
}

function colorValue(resources: Document, name: string): string {
  const value = resources.querySelector(`resources > color[name="${name}"]`)?.textContent?.trim();
  expect(value, name).toBeTruthy();
  return (value as string).toUpperCase();
}

describe("the Android system splash is the ink field and the coral mark", () => {
  const launch = styleItems(xml(STYLES), "AppTheme.NoActionBarLaunch");

  it("gives the OS the field, the mark and the theme to hand over to", () => {
    expect(launch).toMatchObject({
      windowSplashScreenBackground: "@color/colorPrimaryDark",
      windowSplashScreenAnimatedIcon: "@drawable/ic_splash_mark",
      postSplashScreenTheme: "@style/AppTheme.NoActionBar",
    });
    // The drawable behind the system splash is still the window background
    // for the frame between the splash and the WebView's first paint.
    expect(launch["android:background"]).toBe("@drawable/splash");
  });

  it("paints the field in the ink token every other splash uses", () => {
    expect(colorValue(xml(COLORS), "colorPrimaryDark")).toBe(BRAND_COLORS.inkDeep.toUpperCase());
  });

  it("keeps the mark inside the OS's circular mask without drawing it twice", () => {
    const mark = xml(SPLASH_MARK).documentElement;
    expect(mark.tagName).toBe("inset");
    expect(mark.children).toHaveLength(0);
    expect(mark.getAttributeNS(ANDROID_NAMESPACE, "drawable")).toBe("@mipmap/ic_launcher_foreground");
    const inset = mark.getAttributeNS(ANDROID_NAMESPACE, "inset");
    expect(inset).toMatch(/^\d+%$/);
    // Below about 12% the double-struck X's corners cross the two-thirds mask;
    // above about 25% the mark reads as a dot.
    expect(Number.parseFloat(inset!)).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(inset!)).toBeLessThanOrEqual(25);
  });
});

describe("the window behind the WebView is the page's paper", () => {
  it("names the paper colour as the window background", () => {
    const app = styleItems(xml(STYLES), "AppTheme.NoActionBar");
    expect(app["android:windowBackground"]).toBe("@color/pubmaxx_window_background");
  });

  it("has explicit page colours for a choice that differs from Android night mode", () => {
    expect(colorValue(xml(COLORS), "pubmaxx_page_light")).toBe(colorValue(xml(COLORS), "pubmaxx_window_background"));
    expect(colorValue(xml(COLORS), "pubmaxx_page_dark")).toBe(colorValue(xml(NIGHT_COLORS), "pubmaxx_window_background"));
  });

  it("is the page's light paper by day and its dark paper by night", () => {
    expect(colorValue(xml(COLORS), "pubmaxx_window_background")).toBe("#F8F2EC");
    expect(colorValue(xml(NIGHT_COLORS), "pubmaxx_window_background")).toBe("#0A0A0B");
  });
});
