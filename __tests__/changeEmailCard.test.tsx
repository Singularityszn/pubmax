// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const updateUser = vi.hoisted(() => vi.fn<(input: { email: string }) => Promise<{ error: unknown }>>());
const supabaseState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/lib/authClient", () => ({
  ensureSupabaseBrowser: async () => supabaseState.client,
}));

import ChangeEmailCard from "@/components/profile/ChangeEmailCard";

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(): Promise<void> {
  await act(async () => {
    root?.render(createElement(ChangeEmailCard));
  });
  await settle();
}

async function submit(value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="email"]');
  if (!input) throw new Error(`no email input in ${container.innerHTML}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector("form")?.requestSubmit();
  });
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.current = { configured: true, user: { id: "user-a", email: "old@example.com" } };
  updateUser.mockReset();
  supabaseState.client = { auth: { updateUser } };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
});

describe("ChangeEmailCard", () => {
  it("renders nothing when sign-in is not configured, or nobody is signed in", async () => {
    authState.current = { configured: false, user: { id: "user-a" } };
    await render();
    expect(container.innerHTML).toBe("");
    authState.current = { configured: true, user: null };
    await render();
    expect(container.innerHTML).toBe("");
  });

  it("hands the new address to Supabase auth for the current session and says what happens next", async () => {
    updateUser.mockResolvedValue({ error: null });
    await render();
    await submit("  New@Example.com ");
    expect(updateUser).toHaveBeenCalledWith({ email: "new@example.com" });
    expect(container.querySelector("[role=status]")?.textContent).toBe(
      "Check your inbox to confirm the change. The old address gets a note too.",
    );
  });

  it("refuses an address that is not one, or is already the account's, without asking Supabase", async () => {
    await render();
    await submit("not-an-address");
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Enter an email address");
    await submit("old@example.com");
    expect(container.querySelector("[role=alert]")?.textContent).toBe("That's already your email.");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("says the house error line when Supabase refuses", async () => {
    updateUser.mockResolvedValue({ error: { message: "Email rate limit exceeded" } });
    await render();
    await submit("new@example.com");
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Couldn't change your email. Try again.");
    expect(container.textContent).not.toContain("rate limit");
  });
});
