// @vitest-environment jsdom

// Creating or changing a password is a signed-in act on the caller's own
// session. GoTrue binds `auth.updateUser` to the caller's JWT, so the form never
// goes through a route of ours that could name another handle. The read of
// `hasPassword` is tri-state, and a read that did not answer renders nothing.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CURRENT_PASSWORD_WRONG_CODE,
  PASSWORD_CURRENT_WRONG_ERROR,
  PASSWORD_HINT,
  checkPassword,
} from "@/lib/passwordPolicy";

const auth = vi.hoisted(() => ({
  state: { configured: true, user: { id: "account-a" } as { id: string } | null, identityResolved: true },
}));
const readAuthedIdentity = vi.hoisted(() => vi.fn());
const authedActionFetch = vi.hoisted(() => vi.fn());
const updateUser = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth.state }));
vi.mock("@/lib/currentIdentityRead", () => ({ readAuthedIdentity }));
vi.mock("@/lib/authedFetch", () => ({
  AuthActionSessionError: class AuthActionSessionError extends Error {},
  authedActionFetch,
}));
// Only `updateUser` exists on this client, so an admin or by-id write throws.
vi.mock("@/lib/authClient", () => ({
  ensureSupabaseBrowser: async () => ({ auth: { updateUser } }),
}));

import SetAccountPassword from "@/components/auth/SetAccountPassword";

const GOOD = "Pubmaxx1!";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  auth.state = { configured: true, user: { id: "account-a" }, identityResolved: true };
  readAuthedIdentity.mockReset();
  authedActionFetch.mockReset();
  updateUser.mockReset().mockResolvedValue({ error: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function identity(body: { handle?: string | null; hasPassword?: boolean | null } | null) {
  readAuthedIdentity.mockResolvedValue(body === null ? { ok: false } : { ok: true, body });
}

async function mount() {
  await act(async () => root.render(createElement(SetAccountPassword)));
  await act(async () => {});
}

const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`);

async function type(name: string, value: string) {
  const input = field(name);
  if (!input) throw new Error(`no ${name} field`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  const form = host.querySelector("form");
  if (!form) throw new Error("no form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

const alertText = () => host.querySelector('[role="alert"]')?.textContent ?? null;

describe("the password surface waits for an answer", () => {
  it("renders nothing and reads nothing before the live identity answers", async () => {
    auth.state = { ...auth.state, identityResolved: false };
    identity({ handle: "karan", hasPassword: false });
    await mount();
    expect(readAuthedIdentity).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe("");
  });

  it("renders nothing signed out", async () => {
    auth.state = { ...auth.state, user: null };
    identity({ handle: "karan", hasPassword: false });
    await mount();
    expect(host.innerHTML).toBe("");
  });

  it.each([
    ["the read failed", null],
    ["the read answered with no password state", { handle: "karan", hasPassword: null }],
  ])("renders neither form when %s", async (_case, body) => {
    identity(body);
    await mount();
    expect(readAuthedIdentity).toHaveBeenCalledOnce();
    expect(host.innerHTML).toBe("");
  });
});

describe("an account with no password", () => {
  it("is offered a prominent create form with no old-password field", async () => {
    identity({ handle: "karan", hasPassword: false });
    await mount();

    const form = host.querySelector("form");
    expect(host.querySelector("details")).toBeNull();
    expect(host.querySelector('dialog, [role="dialog"]')).toBeNull();
    expect(form?.classList.contains("accountHubPasswordOwed")).toBe(true);
    expect(host.querySelector("h3")?.textContent).toBe("Create password");
    expect(field("current-password")).toBeNull();
    expect(host.querySelector('input[autocomplete="current-password"]')).toBeNull();
  });

  it("presents a form a password manager recognises", async () => {
    identity({ handle: "karan", hasPassword: false });
    await mount();

    const form = host.querySelector("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("autocomplete")).toBe("on");
    expect(field("new-password")?.getAttribute("autocomplete")).toBe("new-password");
    expect(field("new-password-confirmation")?.getAttribute("autocomplete")).toBe("new-password");
    expect(form?.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it("describes the password field with the policy hint", async () => {
    identity({ handle: "karan", hasPassword: false });
    await mount();

    const hintId = field("new-password")?.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    const hint = () => host.querySelector(`[id="${hintId}"]`)?.textContent;
    expect(hint()).toBe(PASSWORD_HINT);
    await type("new-password", "pub");
    expect(hint()).toContain("not yet");
  });

  it("saves through the caller's own session and nothing else", async () => {
    identity({ handle: "karan", hasPassword: false });
    await mount();
    await type("new-password", GOOD);
    await type("new-password-confirmation", GOOD);
    await submit();

    expect(updateUser).toHaveBeenCalledExactlyOnceWith({ password: GOOD });
    expect(authedActionFetch).not.toHaveBeenCalled();
    expect(alertText()).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Password saved");
  });

  it("refuses a password the shared policy refuses, with the policy's words", async () => {
    identity({ handle: "karan", hasPassword: false });
    await mount();
    await type("new-password", "pubmaxxx");
    await type("new-password-confirmation", "pubmaxxx");
    await submit();

    const check = checkPassword("pubmaxxx");
    expect(check.ok).toBe(false);
    expect(alertText()).toBe(check.ok ? null : check.message);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("asks for a handle before any password is saved", async () => {
    identity({ handle: null, hasPassword: false });
    await mount();
    await type("new-password", GOOD);
    await type("new-password-confirmation", GOOD);
    await submit();

    expect(alertText()).toBe("Claim a handle before setting a password.");
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("an account that has a password", () => {
  it("keeps the change form behind one closed disclosure", async () => {
    identity({ handle: "karan", hasPassword: true });
    await mount();

    const details = host.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("Change password");
    expect(host.querySelector("form")?.classList.contains("accountHubPasswordOwed")).toBe(false);
    expect(field("current-password")?.getAttribute("autocomplete")).toBe("current-password");
  });

  it("checks the current password before the new one is written", async () => {
    identity({ handle: "karan", hasPassword: true });
    authedActionFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    await mount();
    await type("current-password", "Old-pass1");
    await type("new-password", GOOD);
    await type("new-password-confirmation", GOOD);
    await submit();

    expect(authedActionFetch).toHaveBeenCalledOnce();
    const [path, init] = authedActionFetch.mock.calls[0] ?? [];
    expect(path).toBe("/api/auth/change-password/verify");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ currentPassword: "Old-pass1" });
    expect(updateUser).toHaveBeenCalledExactlyOnceWith({ password: GOOD });
  });

  it("writes nothing when the current password is wrong", async () => {
    identity({ handle: "karan", hasPassword: true });
    authedActionFetch.mockResolvedValue(
      new Response(JSON.stringify({ code: CURRENT_PASSWORD_WRONG_CODE }), { status: 401 }),
    );
    await mount();
    await type("current-password", "Wrong-pass1");
    await type("new-password", GOOD);
    await type("new-password-confirmation", GOOD);
    await submit();

    expect(alertText()).toBe(PASSWORD_CURRENT_WRONG_ERROR);
    expect(updateUser).not.toHaveBeenCalled();
  });
});
