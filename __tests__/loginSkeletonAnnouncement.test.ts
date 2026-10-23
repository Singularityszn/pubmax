// @vitest-environment jsdom

import { createElement, type FunctionComponent } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A live region announces a CHANGE. Text already present when the region
// mounted is never spoken, so the skeleton's screen-reader line has to arrive
// AFTER the first paint. Only a real mount can show that, which is why this
// file runs in jsdom while the rest of the login coverage renders to a string.

const authState = vi.hoisted(() => ({
  loading: true,
  providers: { google: true, apple: true, microsoft: false },
  providersResolved: true,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    loading: authState.loading,
    configured: true,
    clerkIntegrationConfigured: false,
    socialProviders: authState.providers,
    socialProvidersResolved: authState.providersResolved,
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    signInWithEmail: vi.fn(),
    cancelAuthAttempt: vi.fn(),
    signOut: vi.fn(async () => undefined),
    switchAccount: vi.fn(async () => ({ status: "switched" })),
    welcomeBack: null,
    resumeSignIn: vi.fn(),
    handle: null,
  }),
}));

vi.mock("@/components/auth/MagicLinkForm", () => ({
  default: () => createElement("form", null, "email form"),
}));

vi.mock("@/components/auth/SocialSignInButtons", () => ({
  default: () => createElement("div", null, "social"),
}));

vi.mock("@/components/auth/HandlePasswordSignIn", () => ({
  default: () => createElement("div", null, "password"),
}));

import LoginPageComponent from "@/components/auth/LoginPage";

// The page declares every prop optional with a `= {}` default, so React's own
// inference reads it as taking none. This names the props it really accepts.
const LoginPage = LoginPageComponent as FunctionComponent<
  NonNullable<Parameters<typeof LoginPageComponent>[0]>
>;

// The skeleton only stands when a session hint says a card may be coming.
// These tests are about that skeleton, so the hint is on.
const hinted = { sessionHint: true };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.loading = true;
  authState.providers = { google: true, apple: true, microsoft: false };
  authState.providersResolved = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function statusRegion(): HTMLElement | null {
  return host.querySelector<HTMLElement>(".loginPageSrOnly");
}

describe("the sign-in skeleton's screen-reader line", () => {
  it("arrives as a change after mount, never already spoken", async () => {
    // A mutation whose TARGET is the region means the region was already in the
    // document when its text arrived. Text shipped inside the region's own
    // insertion mutates the region's parent instead, and is never announced.
    const withinRegion: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        const element =
          target instanceof HTMLElement ? target : target.parentElement;
        if (element?.classList.contains("loginPageSrOnly")) {
          withinRegion.push(element.textContent ?? "");
        }
      }
    });
    observer.observe(host, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    await act(async () => {
      root.render(createElement(LoginPage, hinted));
    });
    observer.disconnect();

    expect(withinRegion).toContain("Loading");
    expect(statusRegion()?.textContent).toBe("Loading");
    expect(statusRegion()?.getAttribute("role")).toBe("status");
  });

  // THE REGRESSION THIS ROUND CLOSES: `aria-busy` withholds updates from a live
  // region ANYWHERE beneath it, and busy never clears here - the subtree
  // unmounts instead - so a status node inside the busy container is never
  // spoken however the text arrives. No ancestor of the region may be busy.
  it("keeps every aria-busy container off the live region's ancestry", () => {
    act(() => {
      root.render(createElement(LoginPage, hinted));
    });

    const region = statusRegion();
    expect(region).not.toBeNull();

    const busyAncestors: string[] = [];
    for (
      let node = region?.parentElement ?? null;
      node && node !== document.body;
      node = node.parentElement
    ) {
      if (node.getAttribute("aria-busy") === "true") {
        busyAncestors.push(node.className || node.tagName);
      }
    }
    expect(busyAncestors).toEqual([]);

    // The shape it stands beside is still the thing that is busy.
    expect(
      host.querySelector(".loginPageSkeleton")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(host.querySelector("main.loginPage")?.hasAttribute("aria-busy")).toBe(
      false,
    );
  });

  // A live region an ancestor has hidden is not read either.
  it("keeps the live region out of every aria-hidden subtree", () => {
    act(() => {
      root.render(createElement(LoginPage, hinted));
    });

    const region = statusRegion();
    for (
      let node = region?.parentElement ?? null;
      node && node !== document.body;
      node = node.parentElement
    ) {
      expect(node.getAttribute("aria-hidden")).not.toBe("true");
    }
  });

  it("takes the whole region away once the session answers", () => {
    act(() => {
      root.render(createElement(LoginPage, hinted));
    });
    expect(statusRegion()).not.toBeNull();

    authState.loading = false;
    act(() => {
      root.render(createElement(LoginPage, hinted));
    });

    expect(statusRegion()).toBeNull();
    expect(host.querySelector(".loginPageSkeleton")).toBeNull();
  });
});

// The Supabase session in localStorage is the browser's own hint. It holds the
// email door back on a client-side mount, but a hydrating mount keeps the
// server's answer: an email door already painted is never swapped for a
// skeleton.
describe("the stored-session hint", () => {
  beforeEach(() => {
    window.localStorage.setItem("sb-example-auth-token", "{}");
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("keeps the skeleton on a client-side mount with a stored session", () => {
    act(() => {
      root.render(createElement(LoginPage));
    });
    expect(host.querySelector(".loginPageSkeleton")).not.toBeNull();
    expect(host.textContent).not.toContain("email form");
  });

  it("paints the form for an added account despite a stored session", () => {
    act(() => {
      root.render(createElement(LoginPage, { addAccount: true }));
    });
    expect(host.querySelector(".loginPageSkeleton")).toBeNull();
    expect(host.textContent).toContain("email form");
  });

  it("never replaces a hydrated email door with a skeleton", async () => {
    const page = createElement(LoginPage);
    const shell = document.createElement("div");
    document.body.appendChild(shell);
    shell.innerHTML = renderToString(page);
    expect(shell.textContent).toContain("email form");

    let hydrated: Root | undefined;
    await act(async () => {
      hydrated = hydrateRoot(shell, page);
    });
    expect(shell.querySelector(".loginPageSkeleton")).toBeNull();
    expect(shell.textContent).toContain("email form");

    act(() => {
      hydrated?.unmount();
    });
    shell.remove();
  });
});

// The email door paints before the provider read answers. Whatever that read
// says, nothing may land above the field: the provider slot is held open BELOW
// it, and the field the reader may be typing in is never remounted.
describe("the provider slot", () => {
  function emailForm(): Element | null {
    return host.querySelector("form");
  }

  function follows(later: Element, earlier: Element): boolean {
    return Boolean(
      earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  }

  it("holds the slot open below the email door while providers are unknown", () => {
    authState.providersResolved = false;
    act(() => {
      root.render(createElement(LoginPage));
    });

    const form = emailForm();
    const pending = host.querySelectorAll(".loginPageSkeletonProvider");
    expect(form).not.toBeNull();
    expect(pending).toHaveLength(2);
    const slot = pending[0]!.parentElement!;
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(follows(slot, form!)).toBe(true);
  });

  it("collapses an empty slot without touching the email door", () => {
    authState.providersResolved = false;
    act(() => {
      root.render(createElement(LoginPage));
    });
    const form = emailForm();

    authState.providers = { google: false, apple: false, microsoft: false };
    authState.providersResolved = true;
    act(() => {
      root.render(createElement(LoginPage));
    });

    expect(host.querySelector(".loginPageSkeletonProvider")).toBeNull();
    expect(emailForm()).toBe(form);
    expect(form!.previousElementSibling).toBeNull();
  });

  it("puts the provider buttons where the slot was, below the email door", () => {
    authState.providersResolved = false;
    act(() => {
      root.render(createElement(LoginPage));
    });
    const form = emailForm();

    authState.providersResolved = true;
    act(() => {
      root.render(createElement(LoginPage));
    });

    expect(host.querySelector(".loginPageSkeletonProvider")).toBeNull();
    expect(emailForm()).toBe(form);
    const social = [...host.querySelectorAll("div")].find(
      (node) => node.textContent === "social",
    );
    expect(social).toBeDefined();
    expect(follows(social!, form!)).toBe(true);
  });
});
