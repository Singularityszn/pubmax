// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import capacitorConfig from "../capacitor.config";
import { BRAND_COLORS } from "@/lib/brandMark.mjs";
import { NATIVE_SPLASH_CEILING_MS, releaseNativeSplashOnFirstPaint } from "@/lib/nativeSplash";
import { defined } from "@/__tests__/helpers/defined";

// THE APP OPENED ON A BLACK FIELD FOR TWENTY SECONDS.
//
// Measured on the pubmaxx-390x844 simulator on 13 September 2026, a clean
// install of main against production: the WebView's provisional load started
// 1.7s after launch and the first document did not commit until 21.5s, and
// every frame between was the ink field with no mark on it. The page itself
// then painted in 0.9s. Nothing held the launch mark over that wait, because
// the shell had no splash plugin: UILaunchScreen is dismissed with the first
// native frame, whatever the WebView is still doing.
//
// The splash now stays up until the page has painted, and never longer than a
// fixed ceiling, so a dead network still reaches the bundled offline page.

const rootFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

afterEach(() => {
  delete (window as { __pubmaxFirstPaint?: boolean }).__pubmaxFirstPaint;
});

function frames() {
  const queue: Array<() => void> = [];
  return {
    afterPaint: (callback: () => void) => {
      queue.push(callback);
    },
    flush: () => {
      while (queue.length) queue.shift()?.();
    },
  };
}

function xml(path: string): Document {
  const document = new DOMParser().parseFromString(rootFile(path), "application/xml");
  expect(document.getElementsByTagName("parsererror"), `${path} is not well-formed`).toHaveLength(0);
  return document;
}

const childrenNamed = (parent: Element, tagName: string) =>
  [...parent.children].filter((child) => child.tagName === tagName);

type PbxValue = string | PbxValue[] | PbxDict;
type PbxDict = { [key: string]: PbxValue };

/** An OpenStep property list, the format Xcode writes project.pbxproj in. */
function parsePbx(text: string): PbxValue {
  const bare = /[\w$@./:+-]+/y;
  let at = 0;
  const skip = () => {
    for (;;) {
      while (/\s/.test(text[at] ?? "")) at++;
      if (text.startsWith("/*", at)) at = text.indexOf("*/", at) + 2;
      else if (text.startsWith("//", at)) at = text.indexOf("\n", at) + 1;
      else return;
    }
  };
  const expectChar = (char: string) => {
    skip();
    if (text[at] !== char) throw new Error(`project.pbxproj: expected ${char} at ${at}`);
    at++;
  };
  const value = (): PbxValue => {
    skip();
    if (text[at] === "{") {
      at++;
      const dict: PbxDict = {};
      for (skip(); text[at] !== "}"; skip()) {
        const key = value() as string;
        expectChar("=");
        dict[key] = value();
        expectChar(";");
      }
      at++;
      return dict;
    }
    if (text[at] === "(") {
      at++;
      const list: PbxValue[] = [];
      for (skip(); text[at] !== ")"; skip()) {
        list.push(value());
        skip();
        if (text[at] === ",") at++;
      }
      at++;
      return list;
    }
    if (text[at] === '"') {
      let out = "";
      for (at++; text[at] !== '"'; at++) {
        if (text[at] === "\\") at++;
        out += text[at];
      }
      at++;
      return out;
    }
    bare.lastIndex = at;
    const token = bare.exec(text);
    if (!token) throw new Error(`project.pbxproj: unexpected ${JSON.stringify(text.slice(at, at + 20))}`);
    at += token[0].length;
    return token[0];
  };
  return value();
}

describe("the launch splash is held until the page paints", () => {
  it("does nothing off the shell: no plugin load", async () => {
    const loadPlugin = vi.fn();
    const clock = frames();
    releaseNativeSplashOnFirstPaint({
      isNative: () => false,
      loadPlugin,
      afterPaint: clock.afterPaint,
    });
    clock.flush();
    await Promise.resolve();
    expect(loadPlugin).not.toHaveBeenCalled();
  });

  it("hides the splash once, after the frame", async () => {
    const hide = vi.fn(async () => {});
    const loadPlugin = vi.fn(async () => ({ hide }));
    const clock = frames();
    const deps = { isNative: () => true, loadPlugin, afterPaint: clock.afterPaint };
    releaseNativeSplashOnFirstPaint(deps);
    // Nothing before the page has had a frame to paint in.
    await Promise.resolve();
    expect(loadPlugin).not.toHaveBeenCalled();
    clock.flush();
    await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());

    // A second mount (a remounted shell chrome) spends nothing.
    releaseNativeSplashOnFirstPaint(deps);
    clock.flush();
    await Promise.resolve();
    expect(loadPlugin).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
  });

  it("stays silent when the plugin cannot load, because the ceiling still hides it", async () => {
    const clock = frames();
    releaseNativeSplashOnFirstPaint({
      isNative: () => true,
      loadPlugin: () => Promise.reject(new Error("not implemented")),
      afterPaint: clock.afterPaint,
    });
    expect(() => clock.flush()).not.toThrow();
    await Promise.resolve();
  });

  it("releases nothing when the chrome unmounts before the frame", async () => {
    const hide = vi.fn(async () => {});
    const clock = frames();
    const cancel = releaseNativeSplashOnFirstPaint({
      isNative: () => true,
      loadPlugin: async () => ({ hide }),
      afterPaint: clock.afterPaint,
    });
    cancel();
    clock.flush();
    await Promise.resolve();
    expect(hide).not.toHaveBeenCalled();
  });
});

describe("the splash is configured on both shells", () => {
  it("auto-hides at the ceiling, on the launch field, with no spinner", () => {
    const splash = capacitorConfig.plugins?.SplashScreen as Record<string, unknown> | undefined;
    expect(splash).toBeDefined();
    // Auto-hide stays ON: it is the ceiling. The page hides it sooner.
    expect(splash?.launchAutoHide).toBe(true);
    expect(splash?.launchShowDuration).toBe(NATIVE_SPLASH_CEILING_MS);
    expect(NATIVE_SPLASH_CEILING_MS).toBe(12_000);
    expect(splash?.showSpinner).toBe(false);
    expect(splash?.backgroundColor).toBe(BRAND_COLORS.inkDeep);
  });

  it("carries the plugin as a dependency, so npx cap sync wires both shells", () => {
    const pkg = JSON.parse(rootFile("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@capacitor/splash-screen"]).toBeDefined();
  });

  it("marks the shell's user agent, so the edge can tell the app from a stranger", () => {
    expect(capacitorConfig.appendUserAgent).toBe("PUBMAXXING-App");
  });
});

describe("the iOS plugin finds the storyboard it loads, and the OS never launches on it", () => {
  // The plugin's iOS half instantiates UILaunchStoryboardName, else a
  // storyboard called LaunchScreen, and the first build with it aborted at
  // launch: "Could not find a storyboard named 'LaunchScreen'". The OS launch
  // screen stays the UILaunchScreen dictionary (__tests__/nativeSplashArt.test.ts).

  it("draws the LaunchMark on the LaunchBackground field, and is not a launch screen", () => {
    const storyboard = xml("ios/App/App/Base.lproj/LaunchScreen.storyboard").documentElement;
    expect(storyboard.hasAttribute("launchScreen")).toBe(false);

    const initialId = storyboard.getAttribute("initialViewController");
    const initial = [...storyboard.getElementsByTagName("viewController")].find(
      (controller) => controller.getAttribute("id") === initialId,
    );
    expect(initial, "the initial view controller is missing").toBeDefined();
    const [view] = childrenNamed(initial!, "view").filter((child) => child.getAttribute("key") === "view");
    expect(view, "the initial view controller has no view").toBeDefined();

    const field = childrenNamed(defined(view), "color").find((color) => color.getAttribute("key") === "backgroundColor");
    expect(field?.getAttribute("name")).toBe("LaunchBackground");
    const images = childrenNamed(defined(view), "subviews")
      .flatMap((subviews) => childrenNamed(subviews, "imageView"))
      .map((image) => image.getAttribute("image"));
    expect(images).toEqual(["LaunchMark"]);
  });

  it("is not named as the launch storyboard in Info.plist", () => {
    const [dict] = childrenNamed(xml("ios/App/App/Info.plist").documentElement, "dict");
    const keys = childrenNamed(defined(dict), "key").map((key) => key.textContent);
    expect(keys).toContain("UILaunchScreen");
    expect(keys).not.toContain("UILaunchStoryboardName");
  });

  it("is copied into the app bundle", () => {
    const project = parsePbx(rootFile("ios/App/App.xcodeproj/project.pbxproj")) as PbxDict;
    const objects = project.objects as Record<string, PbxDict>;
    const bundled = Object.values(objects)
      .filter((object) => object.isa === "PBXResourcesBuildPhase")
      .flatMap((phase) => (phase.files as string[]).map((id) => objects[defined(objects[id]).fileRef as string]));
    const storyboard = bundled.find((file) => defined(file).name === "LaunchScreen.storyboard");
    expect(storyboard?.isa).toBe("PBXVariantGroup");
    const paths = (storyboard!.children as string[]).map((id) => defined(objects[id]).path);
    expect(paths).toEqual(["Base.lproj/LaunchScreen.storyboard"]);
  });
});

describe("the bundled offline page releases the splash for itself", () => {
  // The offline page is served from the binary with no app bundle, so the
  // splash would otherwise stand over it until the ceiling. iOS gives the page
  // the bridge; Android does not, and MainActivity releases it there
  // (android/app/src/test/java/com/pubmaxx/app/OfflineSplashReleaseTest.java).
  const page = new DOMParser().parseFromString(rootFile("native/web-stub/offline.html"), "text/html");
  const shellWindow = window as { Capacitor?: unknown };

  const openPage = () => {
    document.body.innerHTML = page.body.innerHTML;
    const script = [...document.body.querySelectorAll("script")].map((node) => node.textContent).join("\n");
    new Function(script)();
  };

  afterEach(() => {
    delete shellWindow.Capacitor;
    document.body.innerHTML = "";
  });

  it("hides the splash once through the bridge", () => {
    const hide = vi.fn(async () => {});
    shellWindow.Capacitor = { Plugins: { SplashScreen: { hide } } };
    openPage();
    expect(hide).toHaveBeenCalledOnce();
  });

  it("swallows a hide the plugin refuses", async () => {
    const hide = vi.fn(() => Promise.reject(new Error("unavailable")));
    shellWindow.Capacitor = { Plugins: { SplashScreen: { hide } } };
    openPage();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hide).toHaveBeenCalledOnce();
  });

  it("opens without throwing when there is no bridge", () => {
    expect(() => openPage()).not.toThrow();
  });
});
