// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "owner-a" } }));
const requests = vi.hoisted(() => ({ authedActionFetch: vi.fn() }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: auth.user, loading: false, configured: true }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/pal/PalPortrait", () => ({ default: () => null }));
vi.mock("@/components/pubpal/PubPalVoice", () => ({ default: () => null }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: requests.authedActionFetch }));

import PalExperience from "@/components/pal/PalExperience";
import { DEFAULT_PAL_DRAFT, type PubPal } from "@/lib/pubPal";

let container: HTMLDivElement;
let root: Root;

function palFor(ownerId: string): PubPal {
  return {
    id: `pal-${ownerId}`,
    ownerId,
    name: ownerId === "owner-a" ? "Moss" : "Robin",
    adultAttestedAt: "2026-09-30T12:00:00.000Z",
    appearance: DEFAULT_PAL_DRAFT.appearance,
    personality: DEFAULT_PAL_DRAFT.personality,
    voice: DEFAULT_PAL_DRAFT.voice,
    muted: true,
    hidden: false,
    proposalPreferences: { memories: true, routes: true },
    masteryPoints: 0,
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:00:00.000Z",
  };
}

async function renderPal(): Promise<void> {
  await act(async () => {
    root.render(createElement(PalExperience));
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  auth.user = { id: "owner-a" };
  requests.authedActionFetch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Pub Pal memory controls", () => {
  it("shows a failed memory read separately from an empty list and offers retry", async () => {
    requests.authedActionFetch.mockImplementation(async (url: string) => (
      url === "/api/pub-pal"
        ? Response.json({ pal: palFor(auth.user.id) })
        : Response.json({ error: "Memories are unavailable." }, { status: 503 })
    ));

    await renderPal();

    const memories = container.querySelector<HTMLElement>('section[aria-labelledby="pal-memory-title"]');
    expect(memories?.querySelector('[role="alert"]')?.textContent).toBe("Could not load your memories.");
    expect(memories?.textContent).not.toContain("No approved memories yet.");
    const retry = [...(memories?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Try again");
    expect(retry?.disabled).toBe(false);
  });
});
