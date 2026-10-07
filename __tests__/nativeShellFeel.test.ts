import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { afterEach, describe, expect, it, vi } from "vitest";

// The two halves of "this is an app, not a wrapped website": a haptic
// vocabulary that only ever plays inside the shell, and a document stylesheet
// that only ever matches inside the shell. Both are gated on the same
// window.Capacitor seam, so both are stubbed the same way here
// (__tests__/nativePlatform.test.ts is the idiom).
import {
  HAPTIC_OCCASIONS,
  hapticEngineFor,
  playHaptic,
  prefersReducedMotion,
  shouldPlayHaptic,
} from "@/lib/nativeHaptics";
import { NATIVE_SHELL_ATTRIBUTE } from "@/components/native/NativeShellChrome";

type AnyGlobal = { window?: unknown };
const g = globalThis as AnyGlobal;

function stubShell({
  native,
  reducedMotion = false,
}: {
  native: boolean;
  reducedMotion?: boolean;
}): void {
  g.window = {
    Capacitor: { isNativePlatform: () => native, getPlatform: () => "ios" },
    matchMedia: (query: string) => ({
      matches: query.includes("reduce") ? reducedMotion : false,
    }),
  };
}

afterEach(() => {
  delete g.window;
  vi.restoreAllMocks();
});

describe("the haptic vocabulary", () => {
  it("names an occasion, never an intensity", () => {
    // Two surfaces that mean the same thing cannot land on different engines,
    // because a surface picks a word out of this closed set and the table
    // picks the engine.
    expect(HAPTIC_OCCASIONS).toEqual([
      "contribution-kept",
      "selection-kept",
      "selection-released",
      "action-refused",
    ]);
  });

  it("gives every occasion an engine, so nothing falls through silently", () => {
    for (const occasion of HAPTIC_OCCASIONS) {
      const engine = hapticEngineFor(occasion);
      expect(engine, occasion).toBeTruthy();
      expect(["impact", "notification"], occasion).toContain(engine.kind);
    }
  });

  it("reserves the two-beat notification for a kept contribution and a refusal", () => {
    // A Pint Drop is the action the product is built around; a refusal is the
    // only other thing worth interrupting a thumb for.
    expect(hapticEngineFor("contribution-kept")).toEqual({
      kind: "notification",
      style: "Success",
    });
    expect(hapticEngineFor("action-refused")).toEqual({
      kind: "notification",
      style: "Warning",
    });
    expect(hapticEngineFor("selection-kept").kind).toBe("impact");
    expect(hapticEngineFor("selection-released").kind).toBe("impact");
  });

  it("releases lighter than it keeps", () => {
    const kept = hapticEngineFor("selection-kept");
    const released = hapticEngineFor("selection-released");
    expect(kept).toEqual({ kind: "impact", style: "Medium" });
    expect(released).toEqual({ kind: "impact", style: "Light" });
  });
});

describe("the haptic gate", () => {
  it("never buzzes on the web or during a server render", () => {
    expect(shouldPlayHaptic({ isNative: false, reducedMotion: false })).toBe(false);
    // No window at all.
    expect(prefersReducedMotion()).toBe(false);
  });

  it("never buzzes when the device asked for reduced motion", () => {
    // iOS routes vestibular sensitivity through this setting, so a person who
    // set it has asked for this too.
    expect(shouldPlayHaptic({ isNative: true, reducedMotion: true })).toBe(false);
  });

  it("buzzes only inside the shell with motion allowed", () => {
    expect(shouldPlayHaptic({ isNative: true, reducedMotion: false })).toBe(true);
  });

  it("reads reduced motion off the live media query", () => {
    stubShell({ native: true, reducedMotion: true });
    expect(prefersReducedMotion()).toBe(true);
    stubShell({ native: true, reducedMotion: false });
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("playHaptic never gates the action it accompanies", () => {
  it("resolves false on the web rather than rejecting", async () => {
    stubShell({ native: false });
    await expect(playHaptic("contribution-kept")).resolves.toBe(false);
  });

  it("resolves false under reduced motion rather than rejecting", async () => {
    stubShell({ native: true, reducedMotion: true });
    await expect(playHaptic("selection-kept")).resolves.toBe(false);
  });

  it("resolves false rather than rejecting when the plugin is unavailable", async () => {
    // Inside the shell with motion allowed, so the gate opens and the dynamic
    // import runs. There is no native vibrator behind it in node, and the
    // receipt this sits beside must still print.
    stubShell({ native: true });
    await expect(playHaptic("contribution-kept")).resolves.toBe(false);
  });
});

describe("the native document stylesheet", () => {
  const css = readFileSync(
    join(process.cwd(), "components", "native", "nativeShell.css"),
    "utf8",
  );

  it("scopes every rule to the native attribute, so the web is untouched", () => {
    const selectors: string[] = [];
    postcss.parse(css).walkRules((rule) => {
      selectors.push(...rule.selectors);
    });
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector, selector).toContain(`[${NATIVE_SHELL_ATTRIBUTE}]`);
    }
  });

  it("stops the document rubber-banding and Android pull-to-refresh", () => {
    // A remote-URL shell that reloads on a downward swipe loses the map
    // camera, the open sheet and the half-typed price.
    expect(css).toContain("overscroll-behavior: none");
  });

  it("takes the long-press callout off chrome and gives it back to prose", () => {
    expect(css).toContain("-webkit-touch-callout: none");
    expect(css).toContain("-webkit-touch-callout: default");
    // A figure, a date or a pub name stays copyable.
    expect(css).toMatch(/:is\(p, li, dd, address[^)]*\)/);
    // And a field stays typable.
    expect(css).toMatch(/:is\(input, textarea/);
  });

  it("suppresses no selection of its own, leaving that to the one site-wide rule", () => {
    // app/globals.css already unselects every control, native included.
    // The callout is the half no web rule covers, so it is the only half here.
    expect(css).not.toContain("user-select");
  });

  it("takes Android's grey tap box away, since every control draws its own press", () => {
    expect(css).toContain("-webkit-tap-highlight-color: transparent");
  });

  it("adds no blur, which the template-pattern fence bans outside sheet chrome", () => {
    expect(css).not.toContain("backdrop-filter");
  });

  it("restates no safe-area inset, so the shared phone geometry cannot fork", () => {
    // The insets belong to the surfaces that own them (siteNav.css,
    // mobileNav.css, mobileMapShell.css) and are measured at 320/390/430 by
    // e2e/mobile-map-chrome-fit.spec.ts. A native-only copy would drift.
    expect(css).not.toContain("env(safe-area-inset");
  });
});
