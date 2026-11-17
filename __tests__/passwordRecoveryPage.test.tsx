// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ configured: true }) }));
vi.mock("@/lib/authClient", () => ({ installRecoveredSession: vi.fn(), preloadPasswordRecoveryAuth: vi.fn() }));
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
