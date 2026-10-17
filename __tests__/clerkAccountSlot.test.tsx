// @vitest-environment jsdom

// Clerk mounts BESIDE the product tree (OptionalClerkProvider), so the account
// controls that need its context are portalled into ClerkAccountSlot hosts.
// These pin that the portal carries ClerkProvider's context into the slot, that
// a slot stays empty while no Clerk tree is mounted, and that a slot leaves the
// registry when its host unmounts.

import { act, createContext, createElement, useContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerkContext = vi.hoisted(() => ({ current: null as React.Context<string> | null }));

vi.mock("@clerk/nextjs", async () => {
  const { createContext: makeContext } = await import("react");
  clerkContext.current = makeContext("no-clerk-provider");
  return {
    ClerkProvider: ({ children }: { children: ReactNode }) =>
      createElement(clerkContext.current!.Provider, { value: "clerk-provider" }, children),
  };
});

vi.mock("@/components/auth/ClerkAuthRevision", () => ({ default: () => null }));

vi.mock("@/components/auth/ClerkAccountControls", () => ({
  // Reads the mocked provider's context the way Clerk's <Show> would.
  default: function MockClerkAccountControls() {
    const value = useContext(clerkContext.current ?? createContext("missing"));
    return createElement("div", { className: "clerkAccount", "data-context": value });
  },
}));

const { default: ClerkAccountSlot, useClerkAccountSlots } = await import(
  "@/components/auth/ClerkAccountSlot"
);
const { default: ConfiguredClerkTree } = await import("@/components/auth/ConfiguredClerkTree");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle(): Promise<void> {
  // next/dynamic resolves the controls chunk over a few microtasks.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function SlotCount() {
  return createElement("output", { "data-testid": "slot-count" }, useClerkAccountSlots().length);
}

function render(withClerk: boolean, withSlot = true) {
  act(() => {
    root.render(
      createElement(
        "div",
        null,
        createElement("nav", { "data-testid": "product" }, withSlot ? createElement(ClerkAccountSlot) : null),
        createElement(SlotCount),
        withClerk ? createElement(ConfiguredClerkTree) : null,
      ),
    );
  });
}

describe("ClerkAccountSlot", () => {
  it("stays empty while no Clerk tree is mounted", async () => {
    render(false);
    await settle();

    const slot = container.querySelector(".clerkAccountSlot");
    expect(slot).not.toBeNull();
    expect(slot?.childElementCount).toBe(0);
  });

  it("is filled from inside ClerkProvider, so Clerk context reaches the controls", async () => {
    render(true);
    await settle();

    const product = container.querySelector("[data-testid='product']");
    const controls = container.querySelector(".clerkAccountSlot > .clerkAccount");
    expect(controls).not.toBeNull();
    expect(product?.contains(controls)).toBe(true);
    expect(controls?.getAttribute("data-context")).toBe("clerk-provider");
  });

  it("fills a slot without remounting it when Clerk arrives later", async () => {
    render(false);
    const slot = container.querySelector(".clerkAccountSlot");

    render(true);
    await settle();

    expect(container.querySelector(".clerkAccountSlot")).toBe(slot);
    expect(slot?.querySelector(".clerkAccount")).not.toBeNull();
  });

  it("leaves the registry when its host unmounts", async () => {
    render(true);
    await settle();
    expect(container.querySelector("[data-testid='slot-count']")?.textContent).toBe("1");

    render(true, false);
    await settle();

    expect(container.querySelector("[data-testid='slot-count']")?.textContent).toBe("0");
    expect(container.querySelector(".clerkAccount")).toBeNull();
  });
});
