// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  installAccountSession: vi.fn(),
  directSetSession: vi.fn(),
  persist: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    configured: true,
    installAccountSession: state.installAccountSession,
  }),
}));
vi.mock("@/lib/authClient", () => ({
  ensureSupabaseBrowser: async () => ({
    auth: { setSession: state.directSetSession },
  }),
}));
vi.mock("@/lib/authSessionResumeClient", () => ({
  persistSessionForResume: state.persist,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import HandlePasswordSignIn from "@/components/auth/HandlePasswordSignIn";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  state.installAccountSession.mockReset();
  state.installAccountSession.mockResolvedValue({ status: "blocked" });
  state.directSetSession.mockReset();
  state.directSetSession.mockResolvedValue({ error: null });
  state.persist.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        status: "signed_in",
        session: {
          access_token: "account-b-access",
          refresh_token: "account-b-refresh",
        },
      }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

describe("handle-password account replacement", () => {
  it("uses the fail-closed account installer and stops when push retirement blocks", async () => {
    await act(async () => root.render(createElement(HandlePasswordSignIn)));
    const toggle = host.querySelector<HTMLButtonElement>(".loginPageHandlePasswordToggle");
    await act(async () => toggle?.click());
    const form = host.querySelector<HTMLFormElement>("form");

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      expect(state.installAccountSession).toHaveBeenCalledWith({
        accessToken: "account-b-access",
        refreshToken: "account-b-refresh",
      });
    });
    expect(state.directSetSession).not.toHaveBeenCalled();
    expect(state.persist).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Notifications could not be disconnected");
  });
});
