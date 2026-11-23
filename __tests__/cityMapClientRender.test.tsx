// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-nonce": "request-nonce" }) }));
vi.mock("@/components/PubMaxingShell", () => ({
  default: ({ fairPintPrelude }: { fairPintPrelude?: ReactNode }) => <>{fairPintPrelude}</>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("renders /map/london on a client navigation with no dead script tag, and loads the first-paint warm", async () => {
  const { default: CityMapPage } = await import("@/app/map/[city]/page");
  const page = await CityMapPage({ params: Promise.resolve({ city: "london" }) });
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(page));
    const scriptWarnings = errors.mock.calls.filter(([message]) => String(message).includes("Encountered a script tag"));
    expect(scriptWarnings).toEqual([]);
    const warm = [...document.head.querySelectorAll("script")].find((script) =>
      script.getAttribute("src")?.startsWith("/map-first-paint-init.js?v="),
    );
    expect(warm?.async).toBe(true);
  } finally {
    act(() => root.unmount());
    host.remove();
    errors.mockRestore();
  }
});
