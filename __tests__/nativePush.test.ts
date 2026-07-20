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
  __resetNativePushRecovery,
  recoverNativePushRegistration,
  refreshExistingNativePushRegistration,
  registerNativePush,
} from "@/lib/nativePush";
import { __resetPushInstallation, PUSH_INSTALLATION_KEY } from "@/lib/pushInstallation";

let installationValues: Map<string, string>;

beforeEach(() => {
  __resetNativePushRecovery();
  __resetPushInstallation();
  installationValues = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => installationValues.get(key) ?? null,
      setItem: (key: string, value: string) => installationValues.set(key, value),
    },
  });
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
    expect(installationValues.get(PUSH_INSTALLATION_KEY)).toMatch(/^[0-9a-f-]{36}$/i);
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
    expect(fetch).toHaveBeenCalledWith("/api/push-tokens", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      token: "device-token",
      platform: "ios",
      installationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
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
    register.mockImplementationOnce(async () => {
      const onRegistration = addListener.mock.calls.find(([event]) => event === "registration")?.[1];
      queueMicrotask(() => onRegistration({ value: "recovered-token" }));
    });
    await expect(refreshExistingNativePushRegistration()).resolves.toBe(true);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(addListener).toHaveBeenCalledWith("registration", expect.any(Function));
    expect(register).toHaveBeenCalledOnce();
  });

  it("returns the exact OS token needed for logout after a WebView restart", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    register.mockImplementationOnce(async () => {
      const onRegistration = addListener.mock.calls.find(([event]) => event === "registration")?.[1];
      queueMicrotask(() => onRegistration({ value: "shared-device-token" }));
    });

    await expect(recoverNativePushRegistration()).resolves.toEqual({
      status: "registration",
      registration: { token: "shared-device-token", platform: "ios" },
    });
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it("fails closed when the OS cannot re-emit a previously permitted token", async () => {
    register.mockRejectedValueOnce(new Error("APNs unavailable"));
    await expect(recoverNativePushRegistration()).resolves.toEqual({ status: "failed" });
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it("never prompts while trying to recover an older registration", async () => {
    checkPermissions.mockResolvedValue({ receive: "prompt" });
    await expect(refreshExistingNativePushRegistration()).resolves.toBe(false);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});
