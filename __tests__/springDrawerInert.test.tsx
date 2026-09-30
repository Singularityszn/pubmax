// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SpringDrawer from "@/components/map/SpringDrawer";
import { useFocusTrap } from "@/lib/useFocusTrap";

const inertDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom does not implement the browser's reflected inert property.
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get() { return this.hasAttribute("inert"); },
    set(value: boolean) { this.toggleAttribute("inert", value); },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (inertDescriptor) Object.defineProperty(HTMLElement.prototype, "inert", inertDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "inert");
  vi.unstubAllGlobals();
});

function Drawers({ open, trapped, side }: {
  open: boolean;
  trapped: boolean;
  side: "left" | "right";
}) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapped, trapRef);
  return <>
    <SpringDrawer open={open} side={side} snap="half" dragOffsetY={null}
      releaseVelocityY={0} keepMounted data-testid="drawer">
      <button>Open stop</button>
    </SpringDrawer>
    <div ref={trapRef}><button>Other surface</button></div>
  </>;
}

describe.each(["left", "right"] as const)("%s drawer inert ownership", (side) => {
  it.each([false, true])("survives trap and closure transitions (tablet=%s)", async (tablet) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 768px)" ? tablet : true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const render = async (open: boolean, trapped: boolean) => {
      await act(async () => root.render(<Drawers open={open} trapped={trapped} side={side} />));
      return host.querySelector<HTMLElement>('[data-testid="drawer"]')!;
    };

    expect((await render(true, false)).inert).toBe(false);
    expect((await render(false, true)).inert).toBe(true);
    // The trap must not restore a stale closed state over the reopened drawer.
    const reopened = await render(true, false);
    expect(reopened.inert).toBe(false);
    reopened.querySelector("button")!.focus();
    expect(document.activeElement).toBe(reopened.querySelector("button"));

    expect((await render(false, true)).inert).toBe(true);
    // Opening alone cannot release another surface's active modal claim.
    expect((await render(true, true)).inert).toBe(true);
    expect((await render(true, false)).inert).toBe(false);

    expect((await render(true, true)).inert).toBe(true);
    expect((await render(false, true)).inert).toBe(true);
    // Releasing a trap cannot make a closed drawer interactive.
    expect((await render(false, false)).inert).toBe(true);
    expect((await render(true, false)).inert).toBe(false);
  });
});
