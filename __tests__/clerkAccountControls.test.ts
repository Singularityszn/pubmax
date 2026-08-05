import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

vi.mock("@clerk/nextjs", () => ({
  Show: ({ children }: { children: ReactNode }) => children,
  SignInButton: ({ children }: { children: ReactNode }) => children,
  SignUpButton: ({ children }: { children: ReactNode }) => children,
  UserButton: () => null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock("@/lib/clerkIdentity", () => ({
  isClerkConfigured: () => true,
}));

import ClerkAccountControls from "@/components/auth/ClerkAccountControls";

afterEach(() => {
  authState.user = null;
});

describe("Clerk account controls", () => {
  it("stays hidden without a product Supabase session", () => {
    const html = renderToStaticMarkup(createElement(ClerkAccountControls));

    expect(html).toBe("");
  });

  it("is available behind an established product Supabase session", () => {
    authState.user = { id: "account-a" };

    const html = renderToStaticMarkup(createElement(ClerkAccountControls));

    expect(html).toContain("Create account");
  });
});
