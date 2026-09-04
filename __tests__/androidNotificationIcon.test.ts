import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BRAND_COLORS,
  MARK_POLYGONS,
  MARK_SLASH_SIMPLE,
  NOTIFICATION_ICON_DP,
  notificationIconVectorDrawable,
  polygonPathData,
} from "@/lib/brandMark.mjs";

// THE ANDROID HALF OF A PROMISE IS A DIFFERENT FILE, AND IT FAILS IN SILENCE.
//
// From API 21 Android draws a notification's small icon as a SILHOUETTE of its
// alpha channel and paints that silhouette in its own colour. FCM falls back to
// the launcher icon when the manifest names no notification icon, and the
// launcher icon is a full-colour adaptive icon, so what a reader saw was a white
// square. On every push the app ever sent. Push is the retention lever here
// (Step Out, the cheap-pint ping, night signals), so that is the whole feature
// wearing a blob.
//
// iOS needs nothing for the same promise, which is exactly the asymmetry
// AGENTS.md warns about: the two halves sit a file apart and only one of them
// was written down.
//
// A notification icon is THREE things, and any one of them missing is the same
// silent failure: the drawable, the manifest line that names it, and the accent
// colour the manifest can only reference by resource. This file holds all three
// to each other and to the one mark master.

const ROOT = join(__dirname, "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

const DRAWABLE = "android/app/src/main/res/drawable/ic_stat_pubmaxx.xml";
const MANIFEST = "android/app/src/main/AndroidManifest.xml";
const COLORS = "android/app/src/main/res/values/colors.xml";

describe("the notification icon exists and is cut from the mark master", () => {
  it("is byte-for-byte what the generator writes", () => {
    // Regenerating and comparing is the point: a fence that restated the path
    // data would only ever prove itself right, and this drawable's whole job is
    // to be the same mark as everything else.
    expect(read(DRAWABLE)).toBe(notificationIconVectorDrawable());
  });

  it("takes the small-optics cut, because the status bar is 24dp", () => {
    // Below about 24px the ~4u channel between the two thin ascending strokes
    // closes up and the mark turns to mud. The single-slash variant is the same
    // one the 16px favicon.ico member takes.
    const xml = read(DRAWABLE);
    expect(xml).toContain(polygonPathData(MARK_SLASH_SIMPLE));
    expect(xml).toContain(polygonPathData(MARK_POLYGONS.thick));
    // The double-struck pair must NOT be here.
    expect(xml).not.toContain(polygonPathData(MARK_POLYGONS.thinA));
    expect(xml).not.toContain(polygonPathData(MARK_POLYGONS.thinB));
  });

  it("is a vector, so one file serves every density", () => {
    // The alternative is a raster set at five densities, which is five chances
    // to ship one of them stale.
    const xml = read(DRAWABLE);
    expect(xml).toContain("<vector");
    expect(xml).toContain(`android:width="${NOTIFICATION_ICON_DP}dp"`);
    expect(xml).toContain(`android:height="${NOTIFICATION_ICON_DP}dp"`);
  });

  it("states a fill, because a path with none draws nothing", () => {
    // The system replaces the colour, but an omitted fill is a transparent path
    // and a transparent status-bar icon is the same silent failure in a new
    // costume.
    expect(read(DRAWABLE)).toContain('android:fillColor="#FFFFFFFF"');
  });

  it("keeps the whole glyph inside the box the system draws", () => {
    // Android hands a notification icon a 24dp box and expects the art inside
    // it. The mark is scaled about the grid centre, so the check is the scaled
    // extreme against the 64 viewport.
    const scale = Number(/android:scaleX="([\d.]+)"/.exec(read(DRAWABLE))?.[1]);
    expect(Number.isFinite(scale)).toBe(true);
    const points = [MARK_SLASH_SIMPLE, MARK_POLYGONS.thick]
      .flatMap((polygon) => polygon.split(" "))
      .map((pair) => pair.split(",").map(Number) as [number, number]);
    for (const [x, y] of points) {
      for (const value of [x, y]) {
        const drawn = 32 + (value - 32) * scale;
        expect(drawn).toBeGreaterThanOrEqual(0);
        expect(drawn).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe("the manifest names the icon, so FCM never falls back to the launcher", () => {
  const manifest = read(MANIFEST);

  it("declares the default notification icon", () => {
    expect(manifest).toContain("com.google.firebase.messaging.default_notification_icon");
    expect(manifest).toContain('android:resource="@drawable/ic_stat_pubmaxx"');
  });

  it("declares the accent colour beside it", () => {
    expect(manifest).toContain("com.google.firebase.messaging.default_notification_color");
    expect(manifest).toContain('android:resource="@color/pubmaxx_notification_accent"');
  });

  it("keeps both inside <application>, where meta-data is read", () => {
    const application = manifest.slice(
      manifest.indexOf("<application"),
      manifest.indexOf("</application>"),
    );
    expect(application).toContain("default_notification_icon");
    expect(application).toContain("default_notification_color");
  });
});

describe("the accent colour is the brand's, held to the one master", () => {
  it("names the resource the manifest references", () => {
    expect(read(COLORS)).toContain('name="pubmaxx_notification_accent"');
  });

  it("is BRAND_COLORS.coral, so it cannot drift a file apart", () => {
    const value = /name="pubmaxx_notification_accent">([^<]+)</.exec(read(COLORS))?.[1];
    expect(value?.toLowerCase()).toBe(BRAND_COLORS.coral.toLowerCase());
  });
});
