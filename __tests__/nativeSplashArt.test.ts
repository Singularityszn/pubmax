import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { BRAND_COLORS } from "@/lib/brandMark.mjs";
import { defined } from "@/__tests__/helpers/defined";

// THE SPLASH IS THE FIRST FRAME OF THE APP, AND IN LIGHT MODE IT WAS THE WRONG ONE.
//
// docs/STORE_READINESS.md section 7 records an owner lock (#520/#523): the ICON
// is a white tile with the coral mark, and the SPLASH keeps the ink-deep field.
// public/store-assets/splash.svg says the same thing in its own comment and adds
// the reason: one splash serves light and dark, because a bright launch flash is
// exactly what a night-out app should not do.
//
// The committed master obeyed that. The generated native art did not. Every
// LIGHT variant on both platforms was a full-bleed coral field with an ink mark,
// the retired treatment, from an older generation still: its mark was
// coralBright rather than coral. So the defect showed for every reader whose
// phone is in light mode, which is most of them and which includes an App Store
// reviewer's default device.
//
// Nothing caught it. __tests__/storeAssets.test.ts pins the SVG masters and the
// public/store-assets/png/ exports; __tests__/brandIconAssets.test.ts regenerates
// the web and store ICON tiers. Neither reads ios/App/App/Assets.xcassets/
// Splash.imageset/ or android/app/src/main/res/drawable*/splash.png, which is
// where a launching phone actually looks.
//
// This fence reads THE SHIPPED BYTES. It sweeps the resource trees rather than
// listing files, so a density added later is covered the day it lands, and it
// asserts a floor on the count so an empty sweep cannot pass by finding nothing.

const ROOT = join(__dirname, "..");
const MASTER = join(ROOT, "public/store-assets/png/splash/splash-2732.png");
const IOS_SPLASH = join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset");
const ANDROID_RES = join(ROOT, "android/app/src/main/res");
// THE iOS LAUNCH SCREEN IS NOT THE SPLASH IMAGESET. Capacitor's storyboard
// route drew a plain black frame on the iOS 26 runtime whatever it held (a
// coral root view with no image launched black too), so the launch screen is
// the Info.plist kind: UILaunchScreen naming a colour set for the field and
// an imageset for the mark, both cut from the same master by
// scripts/gen-native-app-icons.mjs. docs/proof/mobile-app-design/
// ios-sim-iphone17pro/launch/ holds the before and after.
const IOS_LAUNCH_MARK = join(ROOT, "ios/App/App/Assets.xcassets/LaunchMark.imageset");
const IOS_LAUNCH_BACKGROUND = join(
  ROOT,
  "ios/App/App/Assets.xcassets/LaunchBackground.colorset/Contents.json",
);
const IOS_INFO_PLIST = join(ROOT, "ios/App/App/Info.plist");
const IOS_LAUNCH_MARK_SCALES = 3;

// What the sweeps must find. Capacitor stamps 26 Android densities and 6 iOS
// slots today; the floor is those counts, so a set that silently shrank fails.
const ANDROID_SPLASH_FLOOR = 26;
const IOS_SPLASH_FLOOR = 6;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const INK: Rgb = hexToRgb(BRAND_COLORS.inkDeep);
const CORAL: Rgb = hexToRgb(BRAND_COLORS.coral);

async function samples(file: string) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): Rgb => {
    const i = (y * info.width + x) * info.channels;
    return [defined(data[i]), defined(data[i + 1]), defined(data[i + 2])];
  };
  return {
    width: info.width,
    height: info.height,
    // The FIELD, sampled well inside the frame so a stray edge pixel from the
    // rescale cannot decide the answer, and the MARK at dead centre.
    corner: at(6, 6),
    centre: at(info.width >> 1, info.height >> 1),
  };
}

function androidSplashFiles(): string[] {
  return readdirSync(ANDROID_RES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("drawable"))
    .map((entry) => join(ANDROID_RES, entry.name, "splash.png"))
    .filter((file) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    });
}

function iosSplashFiles(): string[] {
  return readdirSync(IOS_SPLASH)
    .filter((name) => name.endsWith(".png"))
    .map((name) => join(IOS_SPLASH, name));
}

function iosLaunchMarkFiles(): string[] {
  return readdirSync(IOS_LAUNCH_MARK)
    .filter((name) => name.endsWith(".png"))
    .map((name) => join(IOS_LAUNCH_MARK, name));
}
const androidFiles = androidSplashFiles();
const iosFiles = iosSplashFiles();
const launchMarkFiles = iosLaunchMarkFiles();
const master = await samples(MASTER);

describe("the splash master is the treatment every phone gets", () => {
  it("is itself the ink field with the coral mark", () => {
    // If this ever fails, the master moved and the rest of this file is
    // measuring against the wrong thing.
    expect(master.corner).toEqual(INK);
    expect(master.centre).toEqual(CORAL);
  });

  it("sweeps a real set on both platforms", () => {
    expect(androidFiles.length).toBeGreaterThanOrEqual(ANDROID_SPLASH_FLOOR);
    expect(iosFiles.length).toBeGreaterThanOrEqual(IOS_SPLASH_FLOOR);
  });
});

describe("no native splash launches on the retired coral field", () => {
  for (const file of [...androidFiles, ...iosFiles]) {
    const name = file.slice(ROOT.length + 1);

    it(`${name} carries the master's field and mark`, async () => {
      const got = await samples(file);
      // The field. This is the whole defect: a coral corner here is the retired
      // full-bleed splash, and it reached every reader in light mode.
      expect(`${name} field`).toBe(`${name} field`);
      expect(got.corner).toEqual(master.corner);
      expect(got.corner).not.toEqual(CORAL);
      // The mark. The old native art drew it in coralBright, so a field-only
      // check would have passed the wrong generation.
      expect(got.centre).toEqual(master.centre);
      expect(got.centre).not.toEqual(hexToRgb(BRAND_COLORS.coralBright));
    });
  }
});

describe("the iOS launch screen is the same master, wired the way iOS 26 draws it", () => {
  it("names the colour set and the imageset from Info.plist, and no storyboard", () => {
    const plist = readFileSync(IOS_INFO_PLIST, "utf8");
    expect(plist).toContain("<key>UILaunchScreen</key>");
    expect(plist).toContain("<key>UIColorName</key>\n\t\t<string>LaunchBackground</string>");
    expect(plist).toContain("<key>UIImageName</key>\n\t\t<string>LaunchMark</string>");
    // The storyboard is what drew black. Naming it again would win over the
    // dictionary and put the defect back with every asset still in place.
    expect(plist).not.toContain("UILaunchStoryboardName");
  });

  it("paints the field from the one ink token, once, for both appearances", () => {
    const colorset = JSON.parse(readFileSync(IOS_LAUNCH_BACKGROUND, "utf8")) as {
      colors: Array<{ appearances?: unknown; color: { components: Record<string, string> } }>;
    };
    expect(colorset.colors).toHaveLength(1);
    expect(defined(colorset.colors[0]).appearances).toBeUndefined();
    const { red, green, blue } = defined(colorset.colors[0]).color.components;
    expect([red, green, blue].map((c) => Number.parseInt(defined(c), 16))).toEqual(INK);
  });

  it("ships the mark at every iPhone scale, cut from the master's own centre", async () => {
    expect(launchMarkFiles).toHaveLength(IOS_LAUNCH_MARK_SCALES);
    for (const file of launchMarkFiles) {
      const got = await samples(file);
      expect(got.width).toBe(got.height);
      expect(got.centre).toEqual(master.centre);
      // The crop is well inside the field, so its corner is the field: the
      // glow around the mark never reaches it.
      expect(got.corner).toEqual(master.corner);
    }
  });
});

describe("light and dark are the same splash, on purpose", () => {
  it("gives every Android night variant the same field as its day one", async () => {
    // drawable-port-night-xhdpi is the night twin of drawable-port-xhdpi. The
    // pair existing at all is Capacitor's doing; them being IDENTICAL is the
    // #523 decision, and it is the half that broke.
    const nights = androidFiles.filter((file) => file.includes("-night"));
    expect(nights.length).toBeGreaterThan(0);
    for (const night of nights) {
      const day = night.replace("-night", "");
      const [a, b] = await Promise.all([samples(night), samples(day)]);
      expect(`${night.slice(ROOT.length + 1)} matches its day twin`).toBe(
        `${night.slice(ROOT.length + 1)} matches its day twin`,
      );
      expect([a.corner, a.centre]).toEqual([b.corner, b.centre]);
    }
  });

  it("hands iOS the same bytes for the light slot and the dark one", () => {
    const dark = iosFiles.filter((file) => file.includes("-dark"));
    expect(dark.length).toBeGreaterThanOrEqual(3);
    for (const file of dark) {
      const light = file.replace("-dark", "");
      expect(readFileSync(file).equals(readFileSync(light))).toBe(true);
    }
  });
});

describe("the generator cannot hold a second opinion about the splash", () => {
  const generator = readFileSync(join(ROOT, "scripts/gen-native-app-icons.mjs"), "utf8");

  it("cuts both native splash sources from the one master file", () => {
    // The rot was a generator that restated the treatment in its own markup and
    // got it wrong. Reading public/store-assets/splash.svg is what stops a
    // second splash treatment existing to be wrong.
    expect(generator).toContain('join(ROOT, "public", "store-assets", "splash.svg")');
    expect(generator).toContain('["splash.png", 2732, SPLASH_MASTER]');
    expect(generator).toContain('["splash-dark.png", 2732, SPLASH_MASTER]');
  });

  it("never paints a splash field of its own", () => {
    // A `fill="${C.coral}"` on a 64x64 rect is the retired splash, and it is
    // also how the icon tiles are drawn, so the check is scoped to the lines
    // that mention a splash.
    const splashLines = generator
      .split("\n")
      .filter((line) => line.includes("splash") && line.includes("svg("));
    expect(splashLines).toEqual([]);
  });
});
