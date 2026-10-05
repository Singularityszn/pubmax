// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ configured: true }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/authClient", () => ({ ensureSupabaseBrowser: vi.fn() }));
vi.mock("@/lib/authSessionResumeClient", () => ({ persistSessionForResume: vi.fn() }));

import HandlePasswordSignIn from "@/components/auth/HandlePasswordSignIn";

let host: HTMLDivElement;
let root: Root;

function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setValue.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function byTestId<T extends HTMLElement>(id: string): T {
  const element = host.querySelector<T>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`missing ${id}`);
  return element;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("HandlePasswordSignIn toggle before hydration", () => {
  // The /login page paints the toggle on the server. Enabled there, a tap
  // before React attaches opens nothing and is lost, for a person on a slow
  // phone as much as for the production smoke suite.
  it("paints the toggle disabled on the server and enables it once React owns it", () => {
    // Unmounting the client root clears its container, so it goes first.
    act(() => root.unmount());
    const html = renderToString(createElement(HandlePasswordSignIn));
    host.innerHTML = html;
    const serverToggle = byTestId<HTMLButtonElement>("e2e-login-toggle");
    expect(serverToggle.disabled).toBe(true);

    const mismatches: unknown[] = [];
    let hydrated!: Root;
    act(() => {
      hydrated = hydrateRoot(host, createElement(HandlePasswordSignIn), {
        onRecoverableError: (error) => mismatches.push(error),
      });
    });
    root = hydrated;
    expect(mismatches).toEqual([]);
    // Hydration adopts the server's button rather than painting a new one.
    expect(byTestId<HTMLButtonElement>("e2e-login-toggle")).toBe(serverToggle);
    expect(serverToggle.disabled).toBe(false);
  });
});

describe("HandlePasswordSignIn form", () => {
  it("submits the form natively from its submit control and holds it disabled while busy", async () => {
    let answer!: (response: Response) => void;
    const fetchDouble = vi.fn(
      () => new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchDouble);

    act(() => root.render(createElement(HandlePasswordSignIn)));
    act(() => byTestId<HTMLButtonElement>("e2e-login-toggle").click());

    const form = host.querySelector("form")!;
    const submit = byTestId<HTMLButtonElement>("e2e-login-submit");
    expect(submit).toBeInstanceOf(HTMLButtonElement);
    expect(submit.type).toBe("submit");
    expect(submit.form).toBe(form);
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe("Sign in");

    act(() => {
      type(byTestId<HTMLInputElement>("e2e-login-handle"), "karan");
      type(byTestId<HTMLInputElement>("e2e-login-password"), "correct horse battery");
    });
    await act(async () => submit.click());

    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(fetchDouble).toHaveBeenCalledWith(
      "/api/auth/handle-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ handle: "karan", password: "correct horse battery" }),
      }),
    );
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe("Signing in…");

    await act(async () => submit.click());
    expect(fetchDouble).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer(new Response(JSON.stringify({ error: "nope" }), { status: 401 }));
    });

    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe("Sign in");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});
