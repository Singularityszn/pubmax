// @vitest-environment jsdom

import { act, createElement, type ComponentType } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "@/components/auth/authContext";

const imports = vi.hoisted(() => ({
  full: vi.fn(), loader: vi.fn(), block: null as Promise<void> | null,
  pending: null as Promise<unknown> | null,
}));
vi.mock("@/components/auth/SignInButton", async (importOriginal) => {
  imports.full();
  return importOriginal<typeof import("@/components/auth/SignInButton")>();
});
vi.mock("next/dynamic", async () => {
  const { default: dynamic } = await import("next/dist/shared/lib/app-dynamic");
  return {
    default: (loader: () => Promise<{ default: ComponentType }>, options: { ssr?: boolean }) => {
      // Only the unrelated client-only Pint Drop strip is omitted here.
      if (options.ssr === false) return () => null;
      return dynamic(() => {
        imports.loader();
        const pending = imports.block ? imports.block.then(loader) : loader();
        imports.pending = pending;
        return pending;
      }, options);
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {} }),
  usePathname: () => "/",
}));
vi.mock("@/components/auth/usePublicProfileCard", () => ({ usePublicProfileCard: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => "PUBMAXXING" }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const settled = {
  user: null, handle: null, loading: false, configured: true,
  clerkIntegrationConfigured: false, supabaseAuthState: "signed-out",
  socialProviders: { google: false, apple: false, microsoft: false },
  signInWithEmail: async () => ({}), cancelAuthAttempt: () => {},
  signOut: async () => {}, switchAccount: async () => ({ status: "unavailable" }),
} as unknown as AuthContextValue;
let host: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = null;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
  imports.block = null;
});

async function landing(auth?: AuthContextValue) {
  const { default: LandingPage } = await import("@/components/landing/LandingPage");
  return auth
    ? createElement(AuthContext.Provider, { value: auth }, createElement(LandingPage))
    : createElement(LandingPage);
}

function marker() {
  const element = host.querySelector<HTMLElement>(".lpNav [data-auth-configured]");
  expect(element).not.toBeNull();
  return element!;
}

async function serverRender(auth: AuthContextValue) {
  const stream = await renderToReadableStream(await landing(auth));
  await stream.allReady;
  host.innerHTML = await new Response(stream).text();
}

describe("landing compact account admission", () => {
  it("keeps keyless SSR and hydration empty without importing the full account body", async () => {
    const element = await landing();
    host.innerHTML = renderToString(element);
    expect(marker().outerHTML).toBe('<span hidden="" data-auth-configured="false" data-auth-resolved="false" data-auth-empty="true"></span>');
    await act(async () => { root = hydrateRoot(host, element); });
    expect(marker().outerHTML).toBe('<span hidden="" data-auth-configured="false" data-auth-resolved="true" data-auth-empty="true"></span>');
    expect(imports.full).not.toHaveBeenCalled();
    expect(imports.loader).not.toHaveBeenCalled();
  });

  it("keeps the pending importer inert and exposes the full body as soon as it resolves", async () => {
    let release!: () => void;
    imports.block = new Promise<void>((resolve) => { release = resolve; });
    root = createRoot(host);
    await act(async () => root?.render(await landing(settled)));
    expect(marker().dataset.authConfigured).toBe("true");
    expect(marker().dataset.authResolved).toBe("false");
    expect(marker().getAttribute("aria-hidden")).toBe("true");
    expect(marker().hasAttribute("inert")).toBe(true);
    expect(marker().querySelector("button, a, input, [tabindex]")).toBeNull();
    expect(imports.loader).toHaveBeenCalledTimes(1);
    expect(imports.full).not.toHaveBeenCalled();
    await act(async () => {
      release();
      await imports.pending;
    });
    expect(marker().dataset.authResolved).toBe("true");
    expect(host.querySelector(".lpNav button.authCompactTrigger")?.getAttribute("aria-label")).toBe("Sign in");
  });

  it("streams the configured full sign-in body and retains its first menu action", async () => {
    await serverRender(settled);
    expect(marker().dataset.authConfigured).toBe("true");
    expect(marker().dataset.authResolved).toBe("false");
    expect(host.querySelector(".lpNav .authCompactTrigger")?.textContent).toContain("Sign in");
    await act(async () => { root = hydrateRoot(host, await landing(settled)); });
    expect(marker().dataset.authResolved).toBe("true");
    const trigger = host.querySelector<HTMLButtonElement>(".lpNav button.authCompactTrigger");
    expect(trigger).not.toBeNull();
    act(() => trigger!.click());
    expect(host.querySelector(".lpNav .authMenu input[type=email]")).not.toBeNull();
  });

  it.each(["unresolved", "unavailable"] as const)("keeps configured %s identity inert in server output", async (supabaseAuthState) => {
    await serverRender({ ...settled, supabaseAuthState });
    expect(marker().dataset.authResolved).toBe("false");
    expect(marker().getAttribute("aria-hidden")).toBe("true");
    expect(marker().hasAttribute("inert")).toBe(true);
    expect(marker().querySelector("button, a, input, [tabindex]")).toBeNull();
  });

  it("admits an established Clerk product session without Supabase configuration", async () => {
    await serverRender({ ...settled, configured: false, clerkIntegrationConfigured: true,
      user: {
        id: "account-a", email: "reader@example.test",
        user_metadata: { full_name: "Night Owl" },
        app_metadata: { provider: "clerk", providers: ["clerk"] },
        aud: "authenticated", created_at: "2026-10-12T00:00:00.000Z",
      },
    });
    expect(marker().dataset.authConfigured).toBe("true");
    expect(host.querySelector(".lpNav .authCompactTrigger")?.getAttribute("aria-label")).toBe("Account options for Night Owl");
  });

  it.each([false, true])("rejects incomplete Clerk admission with configured keys=%s", async (clerkIntegrationConfigured) => {
    await serverRender({ ...settled, configured: false, clerkIntegrationConfigured,
      user: clerkIntegrationConfigured ? null : { id: "account-a" } as AuthContextValue["user"],
    });
    expect(marker().hidden).toBe(true);
    expect(marker().dataset.authConfigured).toBe("false");
    expect(host.querySelector(".lpNav .authCompactTrigger")).toBeNull();
  });
});
