// @vitest-environment jsdom

import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, useAuth } from "@/components/auth/authContext";
import IdentityNudge from "@/components/identity/IdentityNudge";
import { useFocusTrap, readStrictModalFocusTrap } from "@/lib/useFocusTrap";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;

function ExistingModal({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref, "strict-modal");
  return open ? (
    <div ref={ref} role="dialog" aria-label="Existing editor" tabIndex={-1}>
      An existing editor
    </div>
  ) : null;
}

function Shell({ unresolved = false, otherModal = false }: {
  unresolved?: boolean;
  otherModal?: boolean;
}) {
  const defaults = useAuth();
  const [clicks, setClicks] = useState(0);
  return createElement(AuthContext.Provider, {
    value: {
      ...defaults,
      configured: true,
      providerAuthState: unresolved ? "unresolved" : "signed-out",
      supabaseAuthState: unresolved ? "unresolved" : "signed-out",
    },
  },
  createElement("button", { onClick: () => setClicks((count) => count + 1) }, "Describe my night"),
  createElement("output", null, String(clicks)),
  createElement(ExistingModal, { open: otherModal }),
  createElement(IdentityNudge));
}

async function render(props: Parameters<typeof Shell>[0] = {}) {
  await act(async () => { root?.render(createElement(Shell, props)); });
}

async function settlePresentation() {
  await act(async () => { await vi.dynamicImportSettled(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/plan");
  localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
  localStorage.setItem("pubmax:identityNudge:pending:v1", "plan");
  localStorage.setItem("pubmax:identityNudge:pendingAt:v1", String(Date.now()));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  host.remove();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe("the mounted identity prompt", () => {
  it("lets the grace-ending action land, then focuses and dismisses the real dialog", async () => {
    await render();
    const button = host.querySelector("button")!;
    button.focus();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(sessionStorage.getItem("pubmax:prompt-budget:v1")).toBeNull();
    await act(async () => { button.click(); });
    expect(host.querySelector("output")?.textContent).toBe("1");
    await settlePresentation();
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Keep your nights");
    expect(document.activeElement).toBe(dialog);
    expect(sessionStorage.getItem("pubmax:prompt-budget:v1")).toBe("identity-nudge");
    expect(host.querySelectorAll('input[type="email"]')).toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(localStorage.getItem("pubmax:identityNudge:pending:v1")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(readStrictModalFocusTrap()).toBe(false);
  });

  it("keeps unresolved identity neutral without restarting the elapsed grace", async () => {
    await render({ unresolved: true });
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(sessionStorage.getItem("pubmax:prompt-budget:v1")).toBeNull();
    await render({ unresolved: false });
    await settlePresentation();
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Keep your nights");
    expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'));
  });

  it("waits for an existing strict modal and releases its trap when another opens", async () => {
    await render({ otherModal: true });
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Existing editor");
    expect(sessionStorage.getItem("pubmax:prompt-budget:v1")).toBeNull();
    await render({ otherModal: false });
    await settlePresentation();
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Keep your nights");
    await render({ otherModal: true });
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Existing editor");
  });
});
