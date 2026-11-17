// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ configured: true }) }));
vi.mock("@/lib/authClient", () => ({ captureRecoverySessionBaseline: vi.fn(() => ({ value: null, matches: () => true })), installRecoveredSession: vi.fn(), preloadPasswordRecoveryAuth: vi.fn() }));
vi.mock("@/lib/passwordRecoveryClient", () => ({ createPasswordRecoveryFinisher: vi.fn() }));

import PasswordRecoveryPage from "@/components/auth/PasswordRecoveryPage";

let host: HTMLDivElement;
let root: Root;
const token = "a".repeat(56);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("has no native password form before the recovery proof is captured", () => {
  host.innerHTML = renderToString(createElement(PasswordRecoveryPage, { reset: true }));
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelector("input")).toBeNull();
});

it("scrubs the proof without losing the form when the initial hash-change event arrives", () => {
  window.history.replaceState(null, "", `/auth/reset-password#token_hash=${token}`);
  act(() => root.render(createElement(StrictMode, null, createElement(PasswordRecoveryPage, { reset: true }))));
  expect(window.location.hash).toBe("");
  act(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  expect(host.querySelector("#recovery-password")).not.toBeNull();
  expect(host.querySelector("[role=alert]")).toBeNull();
});

it("opens a replacement email link in the same tab after a missing-link error", () => {
  window.history.replaceState(null, "", "/auth/reset-password");
  act(() => root.render(createElement(PasswordRecoveryPage, { reset: true })));
  expect(host.querySelector("#recovery-password")).toBeNull();
  act(() => {
    window.history.replaceState(null, "", `/auth/reset-password#token_hash=${token}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(host.querySelector("#recovery-password")).not.toBeNull();
  expect(window.location.hash).toBe("");
});

it("disables request submission in server HTML until the client takes ownership", () => {
  host.innerHTML = renderToString(createElement(PasswordRecoveryPage));
  expect(host.querySelector("button[type=submit]")?.hasAttribute("disabled")).toBe(true);
  expect(host.querySelector("#recovery-email")?.hasAttribute("disabled")).toBe(true);
});

function fillPassword(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(id)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("marks only confirmation invalid when passwords differ", () => {
  window.history.replaceState(null, "", `/auth/reset-password#token_hash=${token}`);
  act(() => root.render(createElement(PasswordRecoveryPage, { reset: true })));
  act(() => { fillPassword("#recovery-password", "London123!"); fillPassword("#recovery-confirm", "Different123!"); });
  act(() => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const confirm = host.querySelector("#recovery-confirm")!;
  expect(confirm.getAttribute("aria-invalid")).toBe("true");
  expect(host.querySelector("#recovery-password")!.getAttribute("aria-invalid")).toBe("false");
  expect(document.getElementById(confirm.getAttribute("aria-describedby")!)).not.toBeNull();
});

it.each(["unmount", "replacement"])("cancels private verification on page %s before any password mutation", async mode => {
  const actual = await vi.importActual<typeof import("@/lib/passwordRecoveryClient")>("@/lib/passwordRecoveryClient");
  const { createPasswordRecoveryFinisher } = await import("@/lib/passwordRecoveryClient");
  let release!: (value: unknown) => void;
  let began!: () => void;
  let ended!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const settled = new Promise<void>(resolve => { ended = resolve; });
  const auth = {
    verifyOtp: vi.fn(() => { began(); return new Promise<never>(resolve => { release = resolve as (value: unknown) => void; }); }),
    updateUser: vi.fn(), signOut: vi.fn(), getSession: vi.fn(),
  };
  const finish = actual.passwordRecoveryFinisher(auth, token);
  vi.mocked(createPasswordRecoveryFinisher).mockResolvedValue(Object.assign(async (...args: Parameters<typeof finish>) => {
    const result = await finish(...args); ended(); return result;
  }, { dispose: vi.fn() }));
  window.history.replaceState(null, "", `/auth/reset-password#token_hash=${token}`);
  act(() => root.render(createElement(PasswordRecoveryPage, { reset: true })));
  act(() => { fillPassword("#recovery-password", "London123!"); fillPassword("#recovery-confirm", "London123!"); });
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await started;
  });
  act(() => {
    if (mode === "unmount") root.unmount();
    else {
      window.history.replaceState(null, "", `/auth/reset-password#token_hash=${"b".repeat(56)}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  });
  await act(async () => {
    release({ data: { session: { access_token: "private", refresh_token: "private", user: { id: "owner" } }, user: { id: "owner" } }, error: null });
    await settled;
  });
  expect(auth.updateUser).not.toHaveBeenCalled();
  expect(auth.signOut).not.toHaveBeenCalled();
});

it("offers only session completion after a saved password needs cleanup retry", async () => {
  const { createPasswordRecoveryFinisher } = await import("@/lib/passwordRecoveryClient");
  const { installRecoveredSession } = await import("@/lib/authClient");
  const finish = vi.fn()
    .mockResolvedValueOnce({ status: "retry", passwordSaved: true, message: "Your password is saved. Try again to secure your account." })
    .mockResolvedValueOnce({ status: "saved", session: { access_token: "saved", refresh_token: "saved", user: { id: "owner" } } });
  vi.mocked(createPasswordRecoveryFinisher).mockResolvedValue(Object.assign(finish, { dispose: vi.fn() }));
  vi.mocked(installRecoveredSession).mockResolvedValue(true);
  window.history.replaceState(null, "", `/auth/reset-password#token_hash=${token}`);
  act(() => root.render(createElement(PasswordRecoveryPage, { reset: true })));
  act(() => { fillPassword("#recovery-password", "London123!"); fillPassword("#recovery-confirm", "London123!"); });
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(host.querySelector("input")).toBeNull();
  expect(host.querySelector("h1")?.textContent).toBe("Finish signing in");
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelector("h1")?.textContent).toBe("Password saved");
});
