import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// THE PLAN MEMBER COOKIE REACHES DISK BEFORE THE PROCESS CAN DIE (#1540). The
// member cookie now persists (lib/planMemberCapability.ts), but the Android
// WebView writes cookies on a timer, so a host who swiped the app away within
// that window still lost it. MainActivity flushes on the way to the background.
// CookieManager has no JVM double, so this fence holds the shell's source.

const activity = readFileSync(
  join(process.cwd(), "android/app/src/main/java/com/pubmaxx/app/MainActivity.java"),
  "utf8",
);

describe("Android shell cookie flush", () => {
  it("flushes the WebView cookie store when the activity pauses", () => {
    expect(activity).toContain("import android.webkit.CookieManager;");
    const start = activity.indexOf("public void onPause()");
    expect(start, "MainActivity must override onPause").toBeGreaterThan(-1);
    const body = activity.slice(start, activity.indexOf("\n    }", start));
    // The bridge's own pause runs first; the flush is the last thing it does.
    expect(body).toMatch(/super\.onPause\(\);\s*CookieManager\.getInstance\(\)\.flush\(\);/);
  });
});
