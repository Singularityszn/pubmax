import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  addListener,
  checkPermissions,
  isNativeApp,
  nativePlatform,
  register,
  requestPermissions,
} = vi.hoisted(() => ({
  addListener: vi.fn(),
  checkPermissions: vi.fn(),
  isNativeApp: vi.fn(),
  nativePlatform: vi.fn(),
  register: vi.fn(),
  requestPermissions: vi.fn(),
}));

vi.mock("@/lib/nativePlatform", () => ({ isNativeApp, nativePlatform }));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    addListener,
    checkPermissions,
    register,
    requestPermissions,
  },
}));

import {
  activateNativePushNavigation,
  nativePushNavigationPath,
  registerNativePush,
} from "@/lib/nativePush";

beforeEach(() => {
  isNativeApp.mockReturnValue(true);
  nativePlatform.mockReturnValue("ios");
  checkPermissions.mockResolvedValue({ receive: "granted" });
  addListener.mockResolvedValue({ remove: vi.fn() });
  register.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("registerNativePush", () => {
  it("is a no-op outside the native shell", async () => {
    isNativeApp.mockReturnValue(false);

    await expect(registerNativePush()).resolves.toBe(false);

    expect(checkPermissions).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("does not register Android until a real FCM sender exists", async () => {
    nativePlatform.mockReturnValue("android");

    await expect(registerNativePush()).resolves.toBe(false);

    expect(checkPermissions).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("requests prompted permission and stops when it is denied", async () => {
    checkPermissions.mockResolvedValue({ receive: "prompt" });
    requestPermissions.mockResolvedValue({ receive: "denied" });

    await expect(registerNativePush()).resolves.toBe(false);

    expect(requestPermissions).toHaveBeenCalledOnce();
    expect(addListener).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("registers after prompted permission is granted", async () => {
    checkPermissions.mockResolvedValue({ receive: "prompt" });
    requestPermissions.mockResolvedValue({ receive: "granted" });

    await expect(registerNativePush()).resolves.toBe(true);

    expect(requestPermissions).toHaveBeenCalledOnce();
    expect(addListener).toHaveBeenCalledWith("registration", expect.any(Function));
    expect(register).toHaveBeenCalledOnce();
  });

  it("posts delivered tokens with the native platform", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await expect(registerNativePush()).resolves.toBe(true);
    const onRegistration = addListener.mock.calls[0]?.[1];
    onRegistration({ value: "device-token" });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith("/api/push-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "device-token", platform: "ios" }),
    });
  });

  it("does not register when the native platform is unavailable", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    nativePlatform.mockReturnValue(null);

    await expect(registerNativePush()).resolves.toBe(false);

    expect(addListener).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps registration successful when token delivery cannot be persisted", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);

    await expect(registerNativePush()).resolves.toBe(true);
    const onRegistration = addListener.mock.calls[0]?.[1];
    onRegistration({ value: "device-token" });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  });

  it("fails soft when the native push plugin throws", async () => {
    checkPermissions.mockRejectedValue(new Error("plugin unavailable"));

    await expect(registerNativePush()).resolves.toBe(false);

    expect(addListener).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});

describe("nativePushNavigationPath", () => {
  it.each([
    [{ data: { url: "/tonight" } }, "/tonight"],
    [{ data: { url: "/plan/abc?from=push#crew" } }, "/plan/abc?from=push#crew"],
  ])("accepts a safe internal notification target", (notification, expected) => {
    expect(nativePushNavigationPath(notification)).toBe(expected);
  });

  it.each([
    {},
    { data: {} },
    { data: { url: "https://evil.example/tonight" } },
    { data: { url: "//evil.example/tonight" } },
    { data: { url: "/admin" } },
    { data: { url: "/auth/callback#access_token=secret" } },
  ])("rejects a missing, external, or unsupported notification target", (notification) => {
    expect(nativePushNavigationPath(notification)).toBeNull();
  });
});

describe("activateNativePushNavigation", () => {
  it("is a plugin-free no-op outside the native shell", async () => {
    isNativeApp.mockReturnValue(false);

    const cleanup = await activateNativePushNavigation(vi.fn());
    cleanup();

    expect(addListener).not.toHaveBeenCalled();
  });

  it("routes notification taps and removes its listener", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    let onAction: ((event: { notification: { data?: Record<string, unknown> } }) => void) | undefined;
    addListener.mockImplementation(async (event, callback) => {
      if (event === "pushNotificationActionPerformed") onAction = callback;
      return { remove };
    });
    const navigate = vi.fn();

    const cleanup = await activateNativePushNavigation(navigate);
    onAction?.({ notification: { data: { url: "/tonight" } } });
    onAction?.({ notification: { data: { url: "https://evil.example/tonight" } } });

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/tonight");
    cleanup();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("fails soft when the push plugin cannot attach", async () => {
    addListener.mockRejectedValue(new Error("plugin unavailable"));

    await expect(activateNativePushNavigation(vi.fn())).resolves.toEqual(
      expect.any(Function),
    );
  });
});
