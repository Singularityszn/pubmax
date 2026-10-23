// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isNativeApp } from "@/lib/nativePlatform";
import {
  NATIVE_URL_SCHEME,
  nativeDeepLinkPath,
} from "@/lib/nativeDeepLinks";

const appMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: vi.fn() }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: appMocks.addListener,
    getLaunchUrl: appMocks.getLaunchUrl,
  },
}));

const browserMocks = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("@capacitor/browser", () => ({ Browser: { close: browserMocks.close } }));

const native = vi.mocked(isNativeApp);
let activateNativeDeepLinks: typeof import("@/lib/nativeDeepLinks").activateNativeDeepLinks;

beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  ({ activateNativeDeepLinks } = await import("@/lib/nativeDeepLinks"));
  vi.clearAllMocks();
  native.mockReturnValue(true);
  appMocks.getLaunchUrl.mockResolvedValue(undefined);
  appMocks.remove.mockResolvedValue(undefined);
  browserMocks.close.mockResolvedValue(undefined);
});

describe("nativeDeepLinkPath", () => {
  it.each([
    ["https://pubmaxxing.com/plan/abc", "/plan/abc"],
    ["https://pubmaxxing.com/rounds/invite?from=push", "/rounds/invite?from=push"],
    ["https://pubmaxxing.com/p/pub-1#prices", "/p/pub-1#prices"],
    [
      "https://pubmaxxing.com/auth/callback?next=%2Fmap#access_token=token",
      "/auth/callback?next=%2Fmap#access_token=token",
    ],
    // The pin a person actually shares: the pub rides the query.
    ["https://pubmaxxing.com/map?sel=venue-1", "/map?sel=venue-1"],
    // The night a push already opens.
    ["https://pubmaxxing.com/tonight", "/tonight"],
    // The two invites. An invite that opens Safari asks the one person most
    // likely to install to sign in twice.
    ["https://pubmaxxing.com/add/somebody?auto=1", "/add/somebody?auto=1"],
    ["https://pubmaxxing.com/r/CODE1", "/r/CODE1"],
  ])("accepts an allow-listed production link", (url, expected) => {
    expect(nativeDeepLinkPath(url)).toBe(expected);
  });

  it("keeps the exact paths exact", () => {
    // /tonight is a page, not a family: /tonight/anything is a different route
    // and the app would have nothing to show for it.
    expect(nativeDeepLinkPath("https://pubmaxxing.com/tonight/extra")).toBeNull();
    expect(nativeDeepLinkPath("https://pubmaxxing.com/tonightly")).toBeNull();
  });

  it("does not take the whole site with the invite families", () => {
    // /r/ and /add/ are prefixes, so the bare parent must still be refused:
    // neither is a page, and admitting one would open the app on a 404.
    expect(nativeDeepLinkPath("https://pubmaxxing.com/r")).toBeNull();
    expect(nativeDeepLinkPath("https://pubmaxxing.com/add")).toBeNull();
  });

  it.each([
    "https://evil.example/plan/abc",
    "http://pubmaxxing.com/plan/abc",
    "https://www.pubmaxxing.com/plan/abc",
    "https://pubmaxxing.com/admin",
    "https://pubmaxxing.com/auth/callback/anything",
    "not a url",
  ])("rejects links outside the exact origin and route allow-list", (url) => {
    expect(nativeDeepLinkPath(url)).toBeNull();
  });
});

describe("the pubmaxx:// scheme", () => {
  // D20, 13 Sep 2026 audit: `xcrun simctl openurl <udid> pubmaxx://...` failed
  // with LSApplicationWorkspaceErrorDomain error 115, because neither shell
  // registered the scheme. Universal links stay the intended path; the scheme
  // is the fallback, and it opens exactly the families the verified links do.
  it.each([
    [`${NATIVE_URL_SCHEME}://map?sel=venue-1`, "/map?sel=venue-1"],
    [`${NATIVE_URL_SCHEME}://plan/abc#crew`, "/plan/abc#crew"],
    [`${NATIVE_URL_SCHEME}://tonight`, "/tonight"],
    [`${NATIVE_URL_SCHEME}://r/CODE1`, "/r/CODE1"],
  ])("opens the same families as the verified links", (url, expected) => {
    expect(nativeDeepLinkPath(url)).toBe(expected);
  });

  it.each([
    // Any app on a phone can register a custom scheme, so the sign-in return
    // never travels over one: it stays on the verified https link.
    "pubmaxx://auth/callback?code=secret",
    "pubmaxx:///auth/callback?code=secret",
    // One link has one spelling: the family is the host, never an empty host.
    "pubmaxx:///tonight",
    "pubmaxx:///map?sel=venue-1",
    "pubmaxx://admin",
    "pubmaxx://tonight/extra",
    "pubmaxx://someone@map?sel=venue-1",
    "pubmaxx://map:8080?sel=venue-1",
    "pubmaxx:tonight",
    "pubmaxxx://tonight",
  ])("refuses what the verified links would refuse, and the sign-in return", (url) => {
    expect(nativeDeepLinkPath(url)).toBeNull();
  });
});

describe("activateNativeDeepLinks", () => {
  it("is a plugin-free no-op on the web", async () => {
    native.mockReturnValue(false);

    const cleanup = await activateNativeDeepLinks(vi.fn());
    cleanup();

    expect(appMocks.addListener).not.toHaveBeenCalled();
    expect(appMocks.getLaunchUrl).not.toHaveBeenCalled();
  });

  it("routes both cold-start and warm links, then removes the listener", async () => {
    let onOpen: ((event: { url: string }) => void) | undefined;
    appMocks.addListener.mockImplementation(async (_event, callback) => {
      onOpen = callback;
      return { remove: appMocks.remove };
    });
    appMocks.getLaunchUrl.mockResolvedValue({
      url: "https://pubmaxxing.com/plan/cold?invite=1#crew",
    });
    const navigate = vi.fn();

    const cleanup = await activateNativeDeepLinks(navigate);
    expect(navigate).toHaveBeenCalledWith("/plan/cold?invite=1#crew");

    onOpen?.({ url: "https://pubmaxxing.com/rounds/warm" });
    onOpen?.({ url: "https://evil.example/p/nope" });
    expect(navigate).toHaveBeenCalledWith("/rounds/warm");
    expect(navigate).toHaveBeenCalledTimes(2);

    // The custom scheme reaches the same listener on both shells.
    onOpen?.({ url: "pubmaxx://tonight" });
    onOpen?.({ url: "pubmaxx://auth/callback?code=secret" });
    expect(navigate).toHaveBeenLastCalledWith("/tonight");
    expect(navigate).toHaveBeenCalledTimes(3);

    cleanup();
    expect(appMocks.remove).toHaveBeenCalledOnce();
  });

  it("keeps the callback document alive until the native browser has closed", async () => {
    let onOpen: ((event: { url: string }) => void) | undefined;
    appMocks.addListener.mockImplementation(async (_event, callback) => {
      onOpen = callback;
      return { remove: appMocks.remove };
    });
    let finishClose: (() => void) | undefined;
    browserMocks.close.mockImplementation(() => new Promise<void>((resolve) => { finishClose = resolve; }));
    const navigate = vi.fn();
    const cleanup = await activateNativeDeepLinks(navigate);

    onOpen?.({ url: "https://pubmaxxing.com/auth/callback?error=access_denied&next=%2Ftonight" });
    await vi.waitFor(() => expect(browserMocks.close).toHaveBeenCalledOnce());
    expect(navigate).not.toHaveBeenCalled();
    finishClose?.();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith(
      "/auth/callback?error=access_denied&next=%2Ftonight",
    ));
    cleanup();
  });

  it("does not replay the cold link after a full document navigation", async () => {
    appMocks.addListener.mockResolvedValue({ remove: appMocks.remove });
    appMocks.getLaunchUrl.mockResolvedValue({ url: "pubmaxx://map?sel=venue-1" });
    const navigate = vi.fn();
    const cleanup = await activateNativeDeepLinks(navigate);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/map?sel=venue-1");
    cleanup();

    // A document reload loses the module but retains the WebView session.
    vi.resetModules();
    const reloaded = await import("@/lib/nativeDeepLinks");
    const nextNavigate = vi.fn();
    const nextCleanup = await reloaded.activateNativeDeepLinks(nextNavigate);
    expect(nextNavigate).not.toHaveBeenCalled();
    expect(appMocks.getLaunchUrl).toHaveBeenCalledOnce();
    nextCleanup();
  });

  it("still routes repeated and new warm links after the launch was consumed", async () => {
    let onOpen: ((event: { url: string }) => void) | undefined;
    appMocks.addListener.mockImplementation(async (_event, callback) => {
      onOpen = callback;
      return { remove: appMocks.remove };
    });
    appMocks.getLaunchUrl.mockResolvedValue({ url: "pubmaxx://map?sel=venue-1" });
    const coldCleanup = await activateNativeDeepLinks(vi.fn());
    coldCleanup();
    vi.resetModules();
    const reloaded = await import("@/lib/nativeDeepLinks");
    const navigate = vi.fn();
    const cleanup = await reloaded.activateNativeDeepLinks(navigate);
    onOpen?.({ url: "pubmaxx://map?sel=venue-1" });
    onOpen?.({ url: "pubmaxx://tonight" });
    expect(navigate.mock.calls).toEqual([["/map?sel=venue-1"], ["/tonight"]]);
    cleanup();
  });

  it("consumes a launch once when activations overlap", async () => {
    appMocks.addListener.mockResolvedValue({ remove: appMocks.remove });
    appMocks.getLaunchUrl.mockResolvedValue({ url: "pubmaxx://tonight" });
    const navigate = vi.fn();
    const cleanups = await Promise.all([
      activateNativeDeepLinks(navigate),
      activateNativeDeepLinks(navigate),
    ]);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/tonight");
    cleanups.forEach((cleanup) => cleanup());
  });

  it("fails soft if the native plugin is unavailable", async () => {
    appMocks.addListener.mockRejectedValue(new Error("plugin unavailable"));

    await expect(activateNativeDeepLinks(vi.fn())).resolves.toEqual(expect.any(Function));
  });
});
