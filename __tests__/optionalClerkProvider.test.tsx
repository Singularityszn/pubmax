// @vitest-environment jsdom

import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) =>
    createElement("div", { "data-testid": "auth-provider" }, children),
}));

vi.mock("@/components/auth/ConfiguredClerkTree", () => ({
  // Renders children if handed any, so a regression back to wrapping the
  // product still paints it and only the identity checks below catch it.
  default: function MockConfiguredClerkTree({ children }: { children?: React.ReactNode }) {
    return createElement("div", { "data-testid": "clerk-tree" }, children);
  },
}));

const productMounts = vi.hoisted(() => ({ count: 0 }));

/** Stands in for the map: counts mount effects the way a WebGL init would. */
function ProductSurface() {
  useEffect(() => {
    productMounts.count += 1;
  }, []);
  return createElement("main", { "data-testid": "product-surface" }, "Map chrome");
}

const { default: OptionalClerkProvider } = await import(
  "@/components/auth/OptionalClerkProvider"
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  productMounts.count = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderProvider() {
  act(() => {
    root.render(
      createElement(
        OptionalClerkProvider,
        {
          clerkIntegrationConfigured: true,
          appearance: undefined,
        },
        createElement(ProductSurface),
      ),
    );
  });
}

describe("OptionalClerkProvider", () => {
  it("paints product children on the first client render before Clerk loads", () => {
    renderProvider();

    expect(container.querySelector("[data-testid='auth-provider']")).not.toBeNull();
    expect(container.querySelector("[data-testid='product-surface']")).not.toBeNull();
    expect(container.textContent).toContain("Map chrome");
    expect(container.querySelector("[data-testid='clerk-tree']")).toBeNull();
  });

  it("mounts Clerk beside product children after the chunk resolves", async () => {
    renderProvider();

    await act(async () => {
      await Promise.resolve();
    });

    const clerkTree = container.querySelector("[data-testid='clerk-tree']");
    const product = container.querySelector("[data-testid='product-surface']");
    expect(clerkTree).not.toBeNull();
    expect(product).not.toBeNull();
    expect(clerkTree?.contains(product)).toBe(false);
  });

  it("keeps the same product DOM node and mount across the Clerk load", async () => {
    renderProvider();
    const before = container.querySelector("[data-testid='product-surface']");
    expect(before).not.toBeNull();
    expect(productMounts.count).toBe(1);

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='clerk-tree']")).not.toBeNull();
    expect(container.querySelector("[data-testid='product-surface']")).toBe(before);
    expect(before?.isConnected).toBe(true);
    expect(productMounts.count).toBe(1);
  });
});
