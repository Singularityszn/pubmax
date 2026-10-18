// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));
const available = vi.hoisted(() => ({ value: true as boolean | null }));
const persisted = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ configured: true }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/authClient", () => ({ ensureSupabaseBrowser: vi.fn(async () => ({ auth })) }));
vi.mock("@/lib/authSessionResumeClient", () => ({ persistSessionForResume: persisted }));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadPhoneSignInAvailable: vi.fn(async () => available.value),
}));

import PhoneSignIn from "@/components/auth/PhoneSignIn";

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

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  await act(async () => {
    root.render(createElement(PhoneSignIn));
  });
  await settle();
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
  });
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  available.value = true;
  auth.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  auth.verifyOtp.mockReset();
  persisted.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("PhoneSignIn", () => {
  it.each([false, null])("draws no phone door when the dashboard flag reads %s", async (flag) => {
    available.value = flag;
    await render();
    expect(host.querySelector('[data-testid="e2e-login-phone-toggle"]')).toBeNull();
  });

  it("refuses a number that is not a UK mobile without sending a text", async () => {
    await render();
    await act(async () => byTestId<HTMLButtonElement>("e2e-login-phone-toggle").click());
    type(byTestId<HTMLInputElement>("e2e-login-phone"), "+1 415 555 0100");
    await submit(byTestId<HTMLInputElement>("e2e-login-phone").form!);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("UK mobile");
  });

  it("texts a code, then signs in with it and keeps the session for resume", async () => {
    const session = { access_token: "access", refresh_token: "refresh" };
    auth.verifyOtp.mockResolvedValue({ data: { session }, error: null });
    await render();
    await act(async () => byTestId<HTMLButtonElement>("e2e-login-phone-toggle").click());
    type(byTestId<HTMLInputElement>("e2e-login-phone"), "07700 900123");
    await submit(byTestId<HTMLInputElement>("e2e-login-phone").form!);

    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      phone: "+447700900123",
      options: { shouldCreateUser: true, channel: "sms" },
    });
    expect(host.textContent).toContain("07700 900 123");

    type(byTestId<HTMLInputElement>("e2e-login-phone-code"), "123456");
    await submit(byTestId<HTMLInputElement>("e2e-login-phone-code").form!);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ phone: "+447700900123", token: "123456", type: "sms" });
    expect(persisted).toHaveBeenCalledWith(session);
  });

  it("keeps the code step open with one plain line after a wrong code", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { status: 403, code: "otp_expired" } });
    await render();
    await act(async () => byTestId<HTMLButtonElement>("e2e-login-phone-toggle").click());
    type(byTestId<HTMLInputElement>("e2e-login-phone"), "07700900123");
    await submit(byTestId<HTMLInputElement>("e2e-login-phone").form!);
    type(byTestId<HTMLInputElement>("e2e-login-phone-code"), "000000");
    await submit(byTestId<HTMLInputElement>("e2e-login-phone-code").form!);

    expect(persisted).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("That code did not work");
    expect(byTestId<HTMLInputElement>("e2e-login-phone-code")).toBeTruthy();
  });
});
