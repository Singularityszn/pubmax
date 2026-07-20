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

import { __resetNativePushRecovery, refreshExistingNativePushRegistration, registerNativePush } from "@/lib/nativePush";

beforeEach(() => {
  __resetNativePushRecovery();
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

  it("does not post a token when the native platform is unavailable", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    nativePlatform.mockReturnValue(null);

    await registerNativePush();
    const onRegistration = addListener.mock.calls[0]?.[1];
    onRegistration({ value: "device-token" });
    await Promise.resolve();

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

  it("refreshes an existing native token only when permission is already granted", async () => {
    await expect(refreshExistingNativePushRegistration()).resolves.toBe(true);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(addListener).toHaveBeenCalledWith("registration", expect.any(Function));
    expect(register).toHaveBeenCalledOnce();
  });

  it("never prompts while trying to recover an older registration", async () => {
    checkPermissions.mockResolvedValue({ receive: "prompt" });
    await expect(refreshExistingNativePushRegistration()).resolves.toBe(false);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});
