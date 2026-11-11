import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPubPalVoiceStartController,
  palVoiceLineDropped,
  PAL_MICROPHONE_PERMISSION_ERROR,
  requestPalVoiceMicrophone,
} from "@/lib/pubPalVoiceSession";

describe("a voice line that drops", () => {
  it.each([
    ["a socket closed with an error code", { reason: "error", closeCode: 1006, message: "" }, true],
    ["a socket error before close", { reason: "error", message: "Connection failed", context: { type: "error" } }, true],
    ["the provider's own session cap", { reason: "error", message: "max", context: { type: "max_duration_exceeded" } }, false],
    ["the agent ending the call", { reason: "agent", closeCode: 1000 }, false],
    ["the person ending the call", { reason: "user" }, false],
    ["no details at all", undefined, false],
  ])("reads %s", (_label, details, dropped) => {
    expect(palVoiceLineDropped(details)).toBe(dropped);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("Pub Pal voice start controller", () => {
  it("gets microphone permission before grant and connection, then stops the probe", async () => {
    const calls: string[] = [];
    const stop = vi.fn();
    const controller = createPubPalVoiceStartController();
    await expect(controller.start({
      requestMicrophone: async () => {
        calls.push("permission");
        return { getTracks: () => [{ stop }] };
      },
      issueGrant: async () => {
        calls.push("grant");
        return { signedUrl: "wss://voice.example/session" };
      },
      connect: (grant) => {
        calls.push(`connect:${grant.signedUrl}`);
      },
    })).resolves.toBe(true);

    expect(calls).toEqual([
      "permission",
      "grant",
      "connect:wss://voice.example/session",
    ]);
    expect(stop).toHaveBeenCalledOnce();
    expect(controller.isStarting()).toBe(true);
  });

  it("keeps one start attempt across repeated taps until connection settles", async () => {
    const permission = deferred<{ getTracks: () => Array<{ stop: () => void }> }>();
    const issueGrant = vi.fn(async () => ({ signedUrl: "wss://voice.example/session" }));
    const connect = vi.fn();
    const controller = createPubPalVoiceStartController();
    const attempt = {
      requestMicrophone: vi.fn(() => permission.promise),
      issueGrant,
      connect,
    };

    const first = controller.start(attempt);
    const second = controller.start(attempt);
    permission.resolve({ getTracks: () => [{ stop: vi.fn() }] });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(issueGrant).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
    await expect(controller.start(attempt)).resolves.toBe(false);

    controller.settle();
    expect(controller.isStarting()).toBe(false);
  });

  it("unlocks after a failed permission request so the visitor can retry", async () => {
    const requestMicrophone = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"))
      .mockResolvedValueOnce({ getTracks: () => [{ stop: vi.fn() }] });
    const onFailure = vi.fn();
    const issueGrant = vi.fn(async () => ({ signedUrl: "wss://voice.example/session" }));
    const connect = vi.fn();
    const controller = createPubPalVoiceStartController();
    const attempt = {
      requestMicrophone,
      issueGrant,
      connect,
      onFailure,
    };

    await expect(controller.start(attempt)).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledWith(
      "Microphone access is off. Type instead.",
    );
    expect(issueGrant).not.toHaveBeenCalled();
    expect(controller.isStarting()).toBe(false);

    await expect(controller.start(attempt)).resolves.toBe(true);
    expect(issueGrant).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
  });
});

describe("the microphone check before a metered grant", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubMicrophone(permission: () => Promise<{ state: string }>) {
    const stream = { getTracks: () => [] };
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia }, permissions: { query: vi.fn(permission) } });
    return { getUserMedia, stream };
  }

  it("opens no probe once the browser says access is granted", async () => {
    const { getUserMedia } = stubMicrophone(async () => ({ state: "granted" }));
    await expect(requestPalVoiceMicrophone()).resolves.toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it.each([
    ["access is not yet asked", async () => ({ state: "prompt" })],
    ["access was refused", async () => ({ state: "denied" })],
    ["the browser cannot say", async () => { throw new TypeError("microphone is not a permission name"); }],
  ])("probes the microphone when %s", async (_label, permission) => {
    const { getUserMedia, stream } = stubMicrophone(permission);
    await expect(requestPalVoiceMicrophone()).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it("issues no grant when the probe is refused", async () => {
    stubMicrophone(async () => ({ state: "prompt" }));
    const issueGrant = vi.fn(async () => ({ signedUrl: "wss://voice.example/session" }));
    const onFailure = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    await expect(createPubPalVoiceStartController().start({
      requestMicrophone: requestPalVoiceMicrophone,
      issueGrant,
      connect: vi.fn(),
      onFailure,
    })).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledWith(PAL_MICROPHONE_PERMISSION_ERROR);
    expect(issueGrant).not.toHaveBeenCalled();
  });
});
