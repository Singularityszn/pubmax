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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
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
    expect(memories?.querySelector("h2")?.textContent).toBe("What Moss remembers.");
    expect(memories?.querySelector('[role="alert"]')?.textContent).toBe("Could not load your memories.");
    expect(memories?.textContent).not.toContain("No approved memories yet.");
    const retry = [...(memories?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Try again");
    expect(retry?.disabled).toBe(false);

    requests.authedActionFetch.mockResolvedValueOnce(Response.json({ memories: [] }));
    await act(async () => retry?.click());

    expect(memories?.textContent).toContain("No approved memories yet.");
    expect(memories?.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows loading until a successful read confirms that memories are empty", async () => {
    const pending = deferred<Response>();
    requests.authedActionFetch.mockImplementation((url: string) => (
      url === "/api/pub-pal"
        ? Promise.resolve(Response.json({ pal: palFor(auth.user.id) }))
        : pending.promise
    ));

    await renderPal();

    const memories = container.querySelector<HTMLElement>('section[aria-labelledby="pal-memory-title"]');
    expect(memories?.querySelector('[role="status"]')?.textContent).toBe("Loading your memories");
    expect(memories?.textContent).not.toContain("No approved memories yet.");

    await act(async () => pending.resolve(Response.json({ memories: [] })));

    expect(memories?.textContent).toContain("No approved memories yet.");
    expect(memories?.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps a previous owner's delayed retry out of the next owner's memories", async () => {
    const pending = deferred<Response>();
    let firstOwnerReads = 0;
    requests.authedActionFetch.mockImplementation((url: string) => {
      if (url === "/api/pub-pal") return Promise.resolve(Response.json({ pal: palFor(auth.user.id) }));
      if (auth.user.id === "owner-a") {
        firstOwnerReads += 1;
        return firstOwnerReads === 1
          ? Promise.resolve(Response.json({ error: "Unavailable" }, { status: 503 }))
          : pending.promise;
      }
      return Promise.resolve(Response.json({ memories: [{
        id: "memory-b",
        palId: "pal-owner-b",
        kind: "drink_preference",
        value: "Prefers alcohol-free beer",
        provenance: "user_confirmed",
        createdAt: "2026-09-30T12:00:00.000Z",
        updatedAt: "2026-09-30T12:00:00.000Z",
      }] }));
    });

    await renderPal();
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Try again");
    await act(async () => retry?.click());
    auth.user = { id: "owner-b" };
    await renderPal();

    expect(container.querySelector("#pal-home-title")?.textContent).toBe("Robin");
    expect(container.textContent).toContain("Prefers alcohol-free beer");
    await act(async () => pending.resolve(Response.json({ memories: [] })));

    expect(container.textContent).toContain("Prefers alcohol-free beer");
    expect(container.textContent).not.toContain("No approved memories yet.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
