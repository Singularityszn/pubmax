// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: {
    accountRevision: 0,
    supabaseAuthState: "unresolved" as "unresolved" | "authenticated",
    user: null as { id: string } | null,
  },
  fetch: vi.fn(),
  getCurrentUserId: vi.fn(),
}));

const wanted = vi.hoisted(() => ({
  id: "wanted-a",
  ownerActor: "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  venueKind: "curated" as const,
  venueId: "venue-a",
  venueName: "The Dove",
  sourceUrl: "",
  sourcePlatform: "none" as const,
  note: "",
  rawPaste: "The Dove",
  status: "open" as const,
  createdAt: "2026-09-02T12:00:00.000Z",
  fulfilledAt: null,
  promotedListType: null,
  promotedAt: null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ ...state.auth, getCurrentUserId: state.getCurrentUserId }),
}));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: state.fetch }));
vi.mock("@/lib/venueMapUrl", () => ({
  venueMapUrl: (venueId: string) => `/map/${venueId}`,
}));
vi.mock("@/components/wanted/WantedCapture", () => ({
  default: ({
    onSaved,
  }: {
    onSaved?: (wanted: import("@/lib/wanted").WantedDTO) => void;
  }) => createElement(
    "button",
    {
      type: "button",
      "data-testid": "save-wanted",
      onClick: () => onSaved?.(wanted),
    },
    "Save",
  ),
}));
vi.mock("@/components/wanted/WantedPromotionControl", () => ({
  default: () => null,
}));

import WantedList from "@/components/wanted/WantedList";
import { setProviderIdentity } from "@/lib/authProviderRevision";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setProviderIdentity("supabase", null);
  state.auth = {
    accountRevision: 0,
    supabaseAuthState: "unresolved",
    user: null,
  };
  state.fetch.mockReset().mockImplementation(() => new Promise<Response>(() => {}));
  state.getCurrentUserId.mockImplementation(() => state.auth.user?.id ?? null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(WantedList));
  });
}

describe("Wanted saves crossing auth settlement", () => {
  it("keeps a completed save visible after the capture remounts", async () => {
    setProviderIdentity("supabase", "account-a");
    state.auth = {
      accountRevision: 1,
      supabaseAuthState: "unresolved",
      user: null,
    };
    await render();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='save-wanted']")?.click();
    });
    expect(container.textContent).toContain("The Dove");

    state.auth = {
      accountRevision: 2,
      supabaseAuthState: "authenticated",
      user: { id: "account-a" },
    };
    await render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("The Dove");
  });

  it("does not attach an unresolved result to the first account that arrives", async () => {
    await render();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='save-wanted']")?.click();
    });
    expect(container.textContent).toContain("The Dove");

    setProviderIdentity("supabase", "account-a");
    state.auth = {
      accountRevision: 1,
      supabaseAuthState: "authenticated",
      user: { id: "account-a" },
    };
    await render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("The Dove");
  });
});
