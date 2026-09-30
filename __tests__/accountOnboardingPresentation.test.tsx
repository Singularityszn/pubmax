// @vitest-environment jsdom

import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const boundFetch = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/lib/accountBoundFetch", () => ({
  captureAccountAuth: (
    userId: string | null,
    session: { user: { id: string }; access_token: string } | null,
  ) => userId && session?.user.id === userId && session.access_token
    ? { userId, accessToken: session.access_token }
    : null,
  accountBoundFetch: boundFetch,
}));

type BodyModule = typeof import("@/components/identity/AccountOnboardingForm");
let Host: ComponentType;
let root: Root;
let container: HTMLDivElement;
let outside: HTMLButtonElement;
let releaseBody: () => void;
let bodyReady: Promise<void>;
let bodyLoads: number;

function signedIn(id: string): void {
  authState.current = {
    user: { id },
    session: { user: { id }, access_token: `token-${id}` },
    loading: false,
    identityResolved: true,
  };
}

function delayedBody(): void {
  const gate = new Promise<void>((resolve) => { releaseBody = resolve; });
  let moduleReady!: () => void;
  bodyReady = new Promise<void>((resolve) => { moduleReady = resolve; });
  vi.doMock("@/components/identity/AccountOnboardingForm", async () => {
    bodyLoads += 1;
    await gate;
    const bodyModule = await vi.importActual<BodyModule>("@/components/identity/AccountOnboardingForm");
    moduleReady();
    return bodyModule;
  });
}

// jsdom Location is unforgeable. Replace only the global window's location
// view, keeping DOM constructors and event methods bound to the real window.
function stubReload(): ReturnType<typeof vi.fn> {
  const browserWindow = window;
  const reload = vi.fn();
  const location = { href: browserWindow.location.href, reload };
  vi.stubGlobal("window", new Proxy(browserWindow, {
    get(target, property) {
      if (property === "location") return location;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }));
  return reload;
}

async function renderHost(): Promise<void> {
  await act(async () => { root.render(createElement(Host)); });
}

async function showBody(): Promise<void> {
  await act(async () => { releaseBody(); await bodyReady; });
  expect(document.querySelector('input[autocomplete="username"]')).not.toBeNull();
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  signedIn("user-a");
  boundFetch.mockReset();
  boundFetch.mockImplementation(async () => Response.json({ complete: false }));
  bodyLoads = 0;
  delayedBody();
  Host = (await import("@/components/identity/AccountOnboardingHost")).default;
  container = document.createElement("div");
  outside = document.createElement("button");
  outside.inert = false;
  outside.textContent = "Underlying map";
  document.body.append(container, outside);
  outside.focus();
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); releaseBody(); });
  vi.doUnmock("@/components/identity/AccountOnboardingForm");
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("account onboarding form presentation", () => {
  it("starts the account status read before the form import and keeps one focused modal while it loads", async () => {
    let answerStatus!: (response: Response) => void;
    boundFetch.mockImplementation(() => new Promise<Response>((resolve) => { answerStatus = resolve; }));
    await renderHost();
    expect(boundFetch).toHaveBeenCalledTimes(1);
    expect(bodyLoads).toBe(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => { answerStatus(Response.json({ complete: false })); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    expect(outside.inert).toBe(true);
    expect(document.body.textContent).toContain("Loading account setup");
    expect(document.querySelector("input")).toBeNull();

    await showBody();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.activeElement).toBe(dialog);
    expect(outside.inert).toBe(true);
    expect(boundFetch).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Name Optional");
    expect(document.body.textContent).toContain("Date of birth Optional");
  });

  it("never imports fields for a signed-out account or an account that already owns a handle", async () => {
    authState.current = { user: null, session: null, loading: false, identityResolved: true };
    await renderHost();
    expect(boundFetch).not.toHaveBeenCalled();
    expect(bodyLoads).toBe(0);

    signedIn("user-a");
    boundFetch.mockImplementation(async () => Response.json({ complete: false, handle: "night_owl" }));
    await renderHost();
    expect(boundFetch).toHaveBeenCalledTimes(1);
    expect(bodyLoads).toBe(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("explicit retry reloads the document without replacing the modal or repeating status", async () => {
    const reload = stubReload();
    const skewCheck = vi.fn();
    window.addEventListener("pubmax:deployment-skew-check", skewCheck);
    try {
      vi.doMock("@/components/identity/AccountOnboardingForm", () => {
        bodyLoads += 1;
        throw new TypeError("Failed to fetch dynamically imported module");
      });
      await renderHost();
      await vi.waitFor(() => expect(document.body.textContent).toContain("Reload the page to try again"));
      const dialog = document.querySelector('[role="dialog"]');
      expect(document.activeElement).toBe(dialog);
      expect(skewCheck).toHaveBeenCalledTimes(1);
      const retry = document.querySelector<HTMLButtonElement>(".accountOnboardingActions button")!;
      retry.focus();
      await act(async () => { retry.click(); });
      expect(reload).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[role="dialog"]')).toBe(dialog);
      expect(document.activeElement).toBe(retry);
      expect(outside.inert).toBe(true);
      expect(bodyLoads).toBe(1);
      expect(boundFetch).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("pubmax:deployment-skew-check", skewCheck);
    }
  });

  it.each([false, true])("reconnect reloads only when underlying input is clean (dirty: %s)", async (dirty) => {
    const reload = stubReload();
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const draft = document.createElement("input");
    draft.defaultValue = "";
    draft.value = dirty ? "Unsent message" : "";
    document.body.append(draft);
    vi.doMock("@/components/identity/AccountOnboardingForm", () => {
      bodyLoads += 1;
      throw new TypeError("Offline chunk");
    });
    await renderHost();
    await vi.waitFor(() => expect(document.body.textContent).toContain("You look offline"));
    vi.useFakeTimers();
    const dialog = document.querySelector('[role="dialog"]');
    expect(outside.inert).toBe(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(reload).toHaveBeenCalledTimes(dirty ? 0 : 1);
    expect(draft.value).toBe(dirty ? "Unsent message" : "");
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(bodyLoads).toBe(1);
    expect(boundFetch).toHaveBeenCalledTimes(1);
  });

  it.each(["sign-out", "account-switch"])("ignores a late form load after %s and restores underlying focus", async (transition) => {
    await renderHost();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    if (transition === "sign-out") {
      authState.current = { user: null, session: null, loading: false, identityResolved: true };
    } else {
      signedIn("user-b");
      boundFetch.mockImplementation(async () => Response.json({ complete: true, handle: "another_owl" }));
    }
    await renderHost();
    await act(async () => { releaseBody(); await bodyReady; });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(outside);
    expect(outside.inert).toBe(false);
  });

  it.each([false, true])("submits controlled handle and optional drafts after loading (private fields supplied: %s)", async (withPrivateFields) => {
    await renderHost();
    await showBody();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ available: true })));
    const edit = (selector: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(selector)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      edit('input[autocomplete="username"]', "night_owl");
      if (withPrivateFields) {
        edit('input[autocomplete="name"]', "Night Owl");
        edit('input[type="date"]', "2000-02-03");
      }
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const claim = document.querySelector<HTMLButtonElement>(".accountOnboardingActions button")!;
    expect(claim.disabled).toBe(false);
    boundFetch.mockImplementation(async () => Response.json({ handle: "night_owl" }));
    await act(async () => { claim.click(); });
    const [auth, endpoint, init] = boundFetch.mock.calls.at(-1)!;
    expect(auth).toEqual({ userId: "user-a", accessToken: "token-user-a" });
    expect(endpoint).toBe("/api/identity/onboarding");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      handle: "night_owl",
      ...(withPrivateFields ? { fullName: "Night Owl", dateOfBirth: "2000-02-03" } : {}),
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
  });
});
