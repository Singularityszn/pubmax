// @vitest-environment jsdom

// A DIALOG THAT SAYS aria-modal HAS TO BE ONE (review finding CMP-5). The
// contribution gate and the message attachment chooser both declared
// themselves modal and left focus on the page behind them. Each now moves
// focus in, holds Tab inside, inerts the page, leaves on Escape, and hands
// focus back to the control that opened it.

import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

import { ContributionGateDialog } from "@/components/identity/ContributionGateDialog";
import MessageAttachmentPicker from "@/components/messages/MessageAttachmentPicker";

let host: HTMLDivElement;
let root: Root;
const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom lays nothing out, so every node reads as hidden to the trap's Tab
  // walk. Report a parent so the walk sees the dialog's controls.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return document.body; },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (offsetParent) Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParent);
});

function inInert(node: HTMLElement): boolean {
  for (let cursor: HTMLElement | null = node; cursor; cursor = cursor.parentElement) {
    if (cursor.inert) return true;
  }
  return false;
}

function tab(shift = false) {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

function escape() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

function GateHarness() {
  const [open, setOpen] = useState(false);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setOpen(true) }, "Log a price"),
    open
      ? createElement(ContributionGateDialog, {
          mode: "adult_check_required",
          error: null,
          onClose: () => setOpen(false),
        })
      : null,
  );
}

function PickerHarness() {
  const [open, setOpen] = useState(false);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setOpen(true) }, "Add an attachment"),
    createElement(MessageAttachmentPicker, {
      open,
      disabled: false,
      onOpenChange: setOpen,
      onKindSelected: () => {},
      onFileChange: () => {},
    }),
  );
}

describe.each([
  { name: "contribution gate", Harness: GateHarness, opener: "Log a price", last: "Not now", trapsDialog: true },
  // The chooser's trap holds its portal, so the scrim beside the sheet still
  // answers a tap; the first Tab from the sheet is the browser's own move.
  { name: "attachment chooser", Harness: PickerHarness, opener: "Add an attachment", last: "Document", trapsDialog: false },
])("the $name is a real modal", ({ Harness, opener, last, trapsDialog }) => {
  it("moves focus in, holds Tab inside, leaves on Escape and restores focus", async () => {
    await act(async () => root.render(createElement(Harness)));
    const openerButton = [...host.querySelectorAll("button")].find((b) => b.textContent === opener)!;
    openerButton.focus();
    await act(async () => openerButton.click());

    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    // The page behind the dialog is inert while it is open.
    expect(inInert(openerButton)).toBe(true);

    // Tab from the last control wraps to the first rather than walking out
    // into the page, and Shift+Tab from the first wraps to the last.
    const focusables = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")];
    if (trapsDialog) {
      // The trap holds the dialog itself, so it places the first Tab too.
      const event = tab();
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(focusables[0]);
    }
    const lastControl = focusables.find((node) => node.textContent === last)!;
    expect(lastControl).toBe(focusables.at(-1));
    lastControl.focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusables[0]);
    tab(true);
    expect(document.activeElement).toBe(lastControl);

    await act(async () => escape());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(inInert(openerButton)).toBe(false);
    expect(document.activeElement).toBe(openerButton);
  });
});
