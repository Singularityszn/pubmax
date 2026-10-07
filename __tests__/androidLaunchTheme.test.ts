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
const THEME_CSS = "app/theme.css";

function styleBlock(styles: string, name: string): string {
  const start = styles.indexOf(`<style name="${name}"`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return styles.slice(start, styles.indexOf("</style>", start));
}

function colorValue(xml: string, name: string): string {
  const value = new RegExp(`name="${name}">([^<]+)<`).exec(xml)?.[1];
  expect(value, name).toBeTruthy();
  return (value as string).toUpperCase();
}

describe("the Android system splash is the ink field and the coral mark", () => {
  const launch = styleBlock(read(STYLES), "AppTheme.NoActionBarLaunch");

  it("gives the OS the field, the mark and the theme to hand over to", () => {
    expect(launch).toContain('<item name="windowSplashScreenBackground">@color/colorPrimaryDark</item>');
    expect(launch).toContain('<item name="windowSplashScreenAnimatedIcon">@drawable/ic_splash_mark</item>');
    expect(launch).toContain('<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>');
    // The drawable behind the system splash is still the window background
    // for the frame between the splash and the WebView's first paint.
    expect(launch).toContain('<item name="android:background">@drawable/splash</item>');
  });

  it("paints the field in the ink token every other splash uses", () => {
    expect(colorValue(read(COLORS), "colorPrimaryDark")).toBe(BRAND_COLORS.inkDeep.toUpperCase());
  });

  it("keeps the mark inside the OS's circular mask without drawing it twice", () => {
    const mark = read(SPLASH_MARK);
    expect(mark).toContain('android:drawable="@mipmap/ic_launcher_foreground"');
    const inset = /android:inset="(\d+)%"/.exec(mark)?.[1];
    // Below about 12% the double-struck X's corners cross the two-thirds mask;
    // above about 25% the mark reads as a dot.
    expect(Number(inset)).toBeGreaterThanOrEqual(12);
    expect(Number(inset)).toBeLessThanOrEqual(25);
  });
});

describe("the window behind the WebView is the page's paper", () => {
  it("names the paper colour as the window background", () => {
    const app = styleBlock(read(STYLES), "AppTheme.NoActionBar");
    expect(app).toContain('<item name="android:windowBackground">@color/pubmaxx_window_background</item>');
  });

  it("has explicit page colours for a choice that differs from Android night mode", () => {
    expect(colorValue(read(COLORS), "pubmaxx_page_light")).toBe(colorValue(read(COLORS), "pubmaxx_window_background"));
    expect(colorValue(read(COLORS), "pubmaxx_page_dark")).toBe(colorValue(read(NIGHT_COLORS), "pubmaxx_window_background"));
  });

  it("is the page's light paper by day and its dark paper by night", () => {
    // The page's paper is the body remap in app/globals.css (the :root value is
    // the light map's own floor), and the offline stub restates the same value
    // as its light theme-color; both are the colour a reader sees.
    const lightPaper = /--paper:\s*(#[0-9a-fA-F]{6});\s*\/\* page/.exec(read("app/globals.css"))?.[1];
    expect(lightPaper, "page --paper in app/globals.css").toBeTruthy();
    expect(colorValue(read(COLORS), "pubmaxx_window_background")).toBe(
      (lightPaper as string).toUpperCase(),
    );
    const darkPaper = /html\[data-theme="dark"\][\s\S]*?--paper:\s*(#[0-9a-fA-F]{6})/.exec(read(THEME_CSS))?.[1];
    expect(darkPaper, "dark --paper in app/theme.css").toBeTruthy();
    expect(colorValue(read(NIGHT_COLORS), "pubmaxx_window_background")).toBe(
      (darkPaper as string).toUpperCase(),
    );
  });
});
