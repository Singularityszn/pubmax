// @vitest-environment jsdom

// The handle and password sign-in form. A browser and a password manager must
// recognise it as a login form, it may never offer to set a password, and its
// way out is said on every failure, so the words never tell anybody whether a
// handle exists.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HANDLE_PASSWORD_GENERIC_ERROR } from "@/lib/passwordPolicy";

const setSession = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ configured: true }) }));
vi.mock("@/lib/authClient", () => ({ ensureSupabaseBrowser: async () => ({ auth: { setSession } }) }));
vi.mock("@/lib/authSessionResumeClient", () => ({ persistSessionForResume: async () => {} }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import HandlePasswordSignIn from "@/components/auth/HandlePasswordSignIn";

const NO_PASSWORD_GUIDANCE =
  "No password yet? Sign in with your email link and create one from your profile.";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  setSession.mockReset().mockResolvedValue({ error: null });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`);

async function openForm() {
  await act(async () => root.render(createElement(HandlePasswordSignIn)));
  const toggle = host.querySelector<HTMLButtonElement>("button");
  await act(async () => toggle?.click());
}

async function type(name: string, value: string) {
  const input = field(name);
  if (!input) throw new Error(`no ${name} field`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function signIn(handle: string, password: string) {
  await type("username", handle);
  await type("password", password);
  const form = host.querySelector("form");
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("the handle and password sign-in form", () => {
  it("is a login form a browser and a password manager recognise", async () => {
    await openForm();

    const form = host.querySelector("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("autocomplete")).toBe("on");
    expect(field("username")?.getAttribute("autocomplete")).toBe("username");
    expect(field("username")?.getAttribute("autocapitalize")).toBe("none");
    expect(field("password")?.getAttribute("autocomplete")).toBe("current-password");
    expect(form?.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it("never offers to set a password", async () => {
    await openForm();
    expect(host.querySelector('input[autocomplete="new-password"]')).toBeNull();
    expect(host.querySelectorAll('input[type="password"]')).toHaveLength(1);
  });

  it("posts the handle and password to its own route without leaving the page", async () => {
    fetchMock.mockResolvedValue(json(401, { error: HANDLE_PASSWORD_GENERIC_ERROR }));
    await openForm();
    await signIn("karan", "Pubmaxx1!");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe("/api/auth/handle-password");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      handle: "karan",
      password: "Pubmaxx1!",
    });
  });

  it("keeps the signed-in values mounted, so a password manager can offer to save them", async () => {
    fetchMock.mockResolvedValue(
      json(200, { status: "signed_in", session: { access_token: "a", refresh_token: "r" } }),
    );
    await openForm();
    await signIn("karan", "Pubmaxx1!");

    expect(setSession).toHaveBeenCalledExactlyOnceWith({ access_token: "a", refresh_token: "r" });
    expect(field("username")?.value).toBe("karan");
    expect(field("password")?.value).toBe("Pubmaxx1!");
  });

  it("says the same way out after every failure, whoever the handle is", async () => {
    for (const response of [
      json(401, { error: HANDLE_PASSWORD_GENERIC_ERROR }),
      json(429, { error: "Too many attempts. Try again in a few minutes." }),
      json(500, {}),
    ]) {
      fetchMock.mockResolvedValueOnce(response);
      await openForm();
      await signIn("karan", "Pubmaxx1!");

      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      expect(host.textContent).toContain(NO_PASSWORD_GUIDANCE);
      act(() => root.unmount());
      root = createRoot(host);
    }
  });
});
