// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => createElement("img", props),
}));

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Site navigation"),
}));

vi.mock("@/app/admin/VenuePhotoModeration", () => ({
  default: () => null,
}));

import AdminClient from "@/app/admin/AdminClient";
import CoverageDemandQueue from "@/app/admin/CoverageDemandQueue";

let host: HTMLDivElement;
let root: Root;

function findButton(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("coverage demand admin surface", () => {
  it("opens the queue from its own admin tab", async () => {
    await act(async () => {
      root.render(createElement(AdminClient));
    });

    await click(findButton("Coverage demand"));

    expect(host.textContent).toContain("Coverage demand");
    expect(findButton("Coverage demand").getAttribute("aria-selected")).toBe("true");
    expect(findButton("Load demand")).toBeTruthy();
  });

  it("loads ranked demand and reports a partial read", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          summary: [
            {
              area: "Sheffield",
              areaKey: "sheffield",
              matchedPatchId: null,
              signalCount: 3,
              sourceCounts: {
                "area-picker": 1,
                "map-miss": 2,
                "near-empty": 0,
              },
              firstSeen: "2026-08-01T12:00:00.000Z",
              lastSeen: "2026-08-15T12:00:00.000Z",
              email: "hidden@example.com",
            },
          ],
          partial: true,
          sinceDays: 90,
          status: "ready",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(CoverageDemandQueue, {
          ensureAdminSession: vi.fn(async () => ({ status: "open" as const })),
          retryWithFreshSession: vi.fn(async (request) => request()),
        }),
      );
    });
    await click(findButton("Load demand"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/area-demand?sinceDays=90&limit=50",
      { credentials: "include" },
    );
    expect(host.textContent).toContain("Sheffield");
    expect(host.textContent).toContain("3 signals");
    expect(host.textContent).toContain("Map miss 2");
    expect(host.textContent).toContain("Showing recent signals only. Counts can be higher.");
    expect(host.textContent).not.toContain("hidden@example.com");
    expect(
      [...host.querySelectorAll('[role="status"]')].some((node) =>
        node.textContent?.includes("Counts can be higher"),
      ),
    ).toBe(true);
  });

  it("keeps denied and degraded reads distinct from empty demand", async () => {
    const deniedRetry = vi.fn(async (request: () => Promise<Response>) => request());
    await act(async () => {
      root.render(
        createElement(CoverageDemandQueue, {
          ensureAdminSession: vi.fn(async () => ({
            status: "refused" as const,
            message: "Not authorised. Check the admin token.",
          })),
          retryWithFreshSession: deniedRetry,
        }),
      );
    });
    await click(findButton("Load demand"));
    expect(host.textContent).toContain("Not authorised. Check the admin token.");
    expect(host.textContent).not.toContain("No demand");
    expect(deniedRetry).not.toHaveBeenCalled();

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          summary: [],
          partial: false,
          sinceDays: 90,
          status: "degraded",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(
        createElement(CoverageDemandQueue, {
          ensureAdminSession: vi.fn(async () => ({ status: "open" as const })),
          retryWithFreshSession: vi.fn(async (request) => request()),
        }),
      );
    });
    await click(findButton("Load demand"));
    expect(host.textContent).toContain("Coverage history is incomplete. Try again.");
    expect(host.textContent).not.toContain("No demand");
  });

  it("keeps ranked rows when a later refresh fails and cancels its body", async () => {
    const ready = new Response(
      JSON.stringify({
        summary: [
          {
            area: "Leeds",
            areaKey: "leeds",
            matchedPatchId: null,
            signalCount: 2,
            sourceCounts: {
              "area-picker": 0,
              "map-miss": 2,
              "near-empty": 0,
            },
            firstSeen: "2026-08-01T12:00:00.000Z",
            lastSeen: "2026-08-15T12:00:00.000Z",
          },
        ],
        partial: false,
        sinceDays: 90,
        status: "ready",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const failed = new Response("Unavailable", {
      status: 503,
      headers: { "content-type": "text/plain" },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(failed);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(CoverageDemandQueue, {
          ensureAdminSession: vi.fn(async () => ({ status: "open" as const })),
          retryWithFreshSession: vi.fn(async (request) => request()),
        }),
      );
    });
    await click(findButton("Load demand"));
    await click(findButton("Load demand"));

    expect(host.textContent).toContain("Leeds");
    expect(host.textContent).toContain("Could not load coverage demand. Try again.");
    expect(failed.bodyUsed).toBe(true);
  });

  it("withdraws an empty-demand claim when a later refresh fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            summary: [],
            partial: false,
            sinceDays: 90,
            status: "ready",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(CoverageDemandQueue, {
          ensureAdminSession: vi.fn(async () => ({ status: "open" as const })),
          retryWithFreshSession: vi.fn(async (request) => request()),
        }),
      );
    });
    await click(findButton("Load demand"));
    expect(host.textContent).toContain("No demand in the last 90 days");

    await click(findButton("Load demand"));
    expect(host.textContent).toContain("Could not load coverage demand. Try again.");
    expect(host.textContent).not.toContain("No demand");
  });

  it("does not turn a partial empty read into a zero-demand claim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            summary: [],
            partial: true,
            sinceDays: 90,
            status: "ready",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await act(async () => {
      root.render(
        createElement(CoverageDemandQueue, {
          ensureAdminSession: vi.fn(async () => ({ status: "open" as const })),
          retryWithFreshSession: vi.fn(async (request) => request()),
        }),
      );
    });
    await click(findButton("Load demand"));

    expect(host.textContent).toContain(
      "Showing recent signals only. Counts can be higher.",
    );
    expect(host.textContent).not.toContain("No demand");
  });
});
