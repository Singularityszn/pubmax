// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    session: { user: { id: "user-1" }, access_token: "token-author" },
    contributionAuth: { userId: "user-1", accessToken: "token-author" },
    configured: true,
    handle: "mia",
    loading: false,
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/ledger/venue-1" }));

const photos = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({
  authedFetch: (...args: unknown[]) => photos.read(...args),
  authedActionFetch: vi.fn(),
}));

import { LedgerCommunity, LedgerLiveProvider } from "@/components/ledger/LedgerLive";

let container: HTMLDivElement;
let root: Root;

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((answer) => { resolve = answer; });
  return { promise, resolve };
}

function emptyLog() {
  return new Response(JSON.stringify({ claims: [], entries: [], familyEntries: [] }));
}

function emptyVisits() {
  return new Response(JSON.stringify({ reports: [], status: "ready" }));
}

function emptyPhotos() {
  return new Response(JSON.stringify({ photos: [], nextCursor: null, status: "ready" }));
}

async function renderCommunity() {
  await act(async () => root.render(
    <LedgerLiveProvider venueId="venue-1">
      <LedgerCommunity venueId="venue-1" venueName="The Lamb" ledgerUrl="/ledger/venue-1" curatedClaims={[]} />
    </LedgerLiveProvider>,
  ));
}

function button(label: string) {
  const result = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  photos.read.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Ledger contributions during pending reads", () => {
  it.each(["photos", "logbook"])("keeps a visit draft visible when the empty %s read arrives", async (pendingRead) => {
    const pending = deferredResponse();
    photos.read.mockImplementation(() => pendingRead === "photos" ? pending.promise : Promise.resolve(emptyPhotos()));
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.startsWith("/api/ledger/")) {
        return pendingRead === "logbook" ? pending.promise : Promise.resolve(emptyLog());
      }
      return Promise.resolve(emptyVisits());
    }));
    await renderCommunity();
    await act(async () => button("Write yours").click());
    const note = container.querySelector("textarea")!;
    expect(note).not.toBeNull();
    await act(async () => {
      note.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, "A quiet corner upstairs.");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => pending.resolve(pendingRead === "photos" ? emptyPhotos() : emptyLog()));

    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector("textarea")).toBe(note);
    expect(note.value).toBe("A quiet corner upstairs.");
    expect(document.activeElement).toBe(note);
  });

  it.each(["visits", "logbook"])("keeps the photo composer visible when the empty %s read arrives", async (pendingRead) => {
    const pending = deferredResponse();
    photos.read.mockImplementation(async () => emptyPhotos());
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.startsWith("/api/ledger/")) {
        return pendingRead === "logbook" ? pending.promise : Promise.resolve(emptyLog());
      }
      return pendingRead === "visits" ? pending.promise : Promise.resolve(emptyVisits());
    }));
    await renderCommunity();
    await act(async () => button("Add a photo").click());
    const picker = container.querySelector('input[type="file"]');
    expect(picker).not.toBeNull();

    await act(async () => pending.resolve(pendingRead === "visits" ? emptyVisits() : emptyLog()));

    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector('input[type="file"]')).toBe(picker);
    expect(button("Choose a photo")).toBeDefined();
  });
});
