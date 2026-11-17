// @vitest-environment jsdom
import { StrictMode, createElement, useEffect, useLayoutEffect, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { AuthProvider } from "@/components/auth/AuthProvider";
import { useAuth } from "@/components/auth/authContext";

const control = vi.hoisted(() => ({ load: vi.fn(), mounts: 0 }));
vi.mock("@/components/auth/authRuntimeLoader", () => ({ loadAuthRuntime: control.load }));
vi.mock("@/lib/authClient", () => ({ isAuthConfigured: () => true, ensureSupabaseBrowser: vi.fn(async () => null) }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/deploymentSkewRecovery", () => ({ requestDeploymentSkewCheck: vi.fn() }));
vi.mock("@/lib/authProviderAvailability", async (original) => ({
  ...await original<typeof import("@/lib/authProviderAvailability")>(),
  loadSocialAuthProviders: async () => ({ google: true, apple: false, microsoft: false }),
}));
vi.mock("@/lib/browserAuthReturn", async (original) => {
  const actual = await original<typeof import("@/lib/browserAuthReturn")>();
  return { ...actual, captureBrowserAuthReturn: vi.fn(actual.captureBrowserAuthReturn) };
});
const { AuthBoundary } = await import("@/components/auth/AuthBoundary");
const browserReturn = await import("@/lib/browserAuthReturn");
let container: HTMLDivElement;
let root: Root;
let resolveRuntime: (runtime: typeof AuthProvider) => void;
let rejectRuntime: (error: Error) => void;
let mounted = true;

function Runtime({ publishContext }: ComponentProps<typeof AuthProvider>) {
  const initial = useAuth();
  const [value] = useState(() => ({ ...initial, loading: false, providerAuthState: "signed-out" as const,
    supabaseAuthState: "signed-out" as const, getCurrentUserId: () => null }));
  useLayoutEffect(() => { publishContext?.(value); }, [publishContext, value]);
  return <></>;
}
function Product() {
  const auth = useAuth();
  const [value, setValue] = useState("");
  useEffect(() => { control.mounts += 1; }, []);
  return <main data-phase={auth.supabaseAuthState}>
    <input aria-label="Email" value={value} onInput={(event) => setValue(event.currentTarget.value)} />
    <span>{auth.socialProviders.google ? "Google available" : "Checking providers"}</span>
  </main>;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  mounted = true; control.mounts = 0;
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, "", "/login");
  vi.mocked(browserReturn.captureBrowserAuthReturn).mockClear();
  const pending = new Promise<typeof AuthProvider>((resolve, reject) => { resolveRuntime = resolve; rejectRuntime = reject; });
  control.load.mockReset().mockReturnValue(pending);
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  container.remove(); vi.mocked(browserReturn.captureBrowserAuthReturn).mockRestore();
});
function render(strict = false) {
  const tree = createElement(AuthBoundary, { clerkIntegrationConfigured: false }, createElement(Product));
  act(() => root.render(strict ? createElement(StrictMode, null, tree) : tree));
}

describe("the lazy auth boundary", () => {
  it("keeps typed input, focus and the product mount when the runtime arrives", async () => {
    render();
    const input = container.querySelector("input")!;
    input.focus();
    await act(async () => { input.value = "person@example.test"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(container.querySelector("main")?.dataset.phase).toBe("unresolved");
    expect(control.mounts).toBe(1);
    await act(async () => resolveRuntime(Runtime));
    expect(container.querySelector("main")?.dataset.phase).toBe("signed-out");
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("person@example.test");
    expect(document.activeElement).toBe(input);
    expect(control.mounts).toBe(1);
    expect(container.textContent).toContain("Google available");
  });

  it("scrubs callbacks before loading and captures once through Strict Mode replay", async () => {
    window.history.replaceState(null, "", "/auth/callback#access_token=disposable&refresh_token=disposable-refresh&type=magiclink");
    control.load.mockImplementation(() => {
      expect(window.location.hash).toBe("");
      return new Promise<typeof AuthProvider>(() => {});
    });
    render(true);
    await act(async () => { await Promise.resolve(); });
    expect(browserReturn.captureBrowserAuthReturn).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe("");
    expect(container.querySelector("input")).not.toBeNull();
  });

  it("releases callback coordination and shows a truthful failure when loading rejects", async () => {
    window.history.replaceState(null, "", "/auth/callback#access_token=disposable&refresh_token=disposable-refresh&type=magiclink");
    const captured = await browserReturn.captureBrowserAuthReturn();
    expect(captured).not.toBeNull();
    const release = vi.fn();
    vi.mocked(browserReturn.captureBrowserAuthReturn).mockResolvedValueOnce({ ...captured!, releaseCoordination: release });
    render();
    await act(async () => rejectRuntime(new Error("chunk unavailable")));
    expect(release).toHaveBeenCalledOnce();
    expect(container.querySelector("main")?.dataset.phase).toBe("unavailable");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sign-in could not load");
  });

  it("releases a capture when unmounted before the runtime arrives", async () => {
    window.history.replaceState(null, "", "/auth/callback#access_token=disposable&refresh_token=disposable-refresh&type=magiclink");
    const captured = await browserReturn.captureBrowserAuthReturn();
    const release = vi.fn();
    vi.mocked(browserReturn.captureBrowserAuthReturn).mockResolvedValueOnce({ ...captured!, releaseCoordination: release });
    render();
    await act(async () => root.unmount()); mounted = false;
    expect(release).toHaveBeenCalledOnce();
    await act(async () => resolveRuntime(Runtime));
    expect(container.childElementCount).toBe(0);
  });
});
