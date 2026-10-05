// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeState = vi.hoisted(() => ({ isNative: false }));

vi.mock("@/lib/nativePlatform", () => ({
  isNativeApp: () => nativeState.isNative,
}));

import ClientErrorReporter, { CLIENT_ERROR_SESSION_CAP } from "@/components/ClientErrorReporter";
import { defined } from "@/__tests__/helpers/defined";

// GAP 16, the browser half. What matters is that a thrown error reaches the
// endpoint redacted, that one bug does not become a flood, and that the
// reporter itself can never be the thing that throws.

let sendBeacon: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;

function sentPayloads(): Record<string, unknown>[] {
  return sendBeacon.mock.calls.map(([, blob]) => JSON.parse((blob as { __text: string }).__text));
}

beforeEach(() => {
  nativeState.isNative = false;
  sendBeacon = vi.fn().mockReturnValue(true);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeacon });
  // jsdom's Blob does not expose its bytes synchronously; the double keeps the
  // payload readable without turning every assertion into a promise.
  vi.stubGlobal(
    "Blob",
    class {
      __text: string;
      constructor(parts: string[]) {
        this.__text = parts.join("");
      }
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(ClientErrorReporter));
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function throwUncaught(error: unknown) {
  act(() => {
    window.dispatchEvent(
      Object.assign(new Event("error"), { error, message: String(error) }),
    );
  });
}

function rejectUnhandled(reason: unknown) {
  act(() => {
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason }));
  });
}

describe("ClientErrorReporter", () => {
  it("reports an uncaught error, redacted, with the route template", () => {
    window.history.replaceState({}, "", "/u/some-drinker");

    throwUncaught(new TypeError("Failed to fetch https://pubmaxxing.com/api/venue?id=1"));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(defined(sendBeacon.mock.calls[0])[0]).toBe("/api/client-error");
    expect(sentPayloads()[0]).toEqual({
      kind: "error",
      name: "TypeError",
      message: "Failed to fetch <url>",
      path: "/u/[handle]",
      shell: "web",
    });
  });

  it("reports an unhandled rejection and names the native shell", () => {
    nativeState.isNative = true;
    window.history.replaceState({}, "", "/tonight");

    rejectUnhandled(new Error("listings read failed"));

    expect(sentPayloads()[0]).toMatchObject({
      kind: "unhandledrejection",
      message: "listings read failed",
      path: "/tonight",
      shell: "native",
    });
  });

  it("sends one report for the same error thrown over and over", () => {
    window.history.replaceState({}, "", "/map");

    for (let i = 0; i < 10; i += 1) throwUncaught(new TypeError("render loop"));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("caps how many distinct reports one session may send", () => {
    window.history.replaceState({}, "", "/map");

    for (let i = 0; i < CLIENT_ERROR_SESSION_CAP + 4; i += 1) {
      throwUncaught(new TypeError(`distinct failure number ${i}`));
    }

    expect(sendBeacon).toHaveBeenCalledTimes(CLIENT_ERROR_SESSION_CAP);
  });

  it("reports nothing when the event carries neither an error nor a message", () => {
    act(() => {
      window.dispatchEvent(Object.assign(new Event("error"), { error: undefined, message: "" }));
    });

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("still names the class when an error carries an empty message", () => {
    throwUncaught(new RangeError(""));

    expect(sentPayloads()[0]).toMatchObject({ name: "RangeError", message: "RangeError" });
  });

  it("never throws out of the listener when the transport does", () => {
    sendBeacon.mockImplementation(() => {
      throw new Error("beacon refused");
    });
    vi.stubGlobal("fetch", vi.fn());

    expect(() => throwUncaught(new TypeError("boom"))).not.toThrow();
  });

  it("stops listening once unmounted", () => {
    const remove = vi.spyOn(window, "removeEventListener");

    act(() => {
      root.unmount();
    });

    const removed = remove.mock.calls.map(([type]) => type);
    expect(removed).toContain("error");
    expect(removed).toContain("unhandledrejection");

    // The shared afterEach unmount must stay safe on an unmounted root.
    root = createRoot(document.createElement("div"));
  });
});
