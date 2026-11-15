// @vitest-environment jsdom

import { act, createElement } from "react";
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
vi.mock("@/components/profile/ProfileImageCropper", () => ({
  default: ({ onCropped, onCancel }: { onCropped: (file: File) => void; onCancel: () => void }) =>
    createElement("div", null,
      createElement("button", {
        onClick: () => onCropped(new File(["jpeg"], "crop.jpg", { type: "image/jpeg" })),
      }, "Use photo"),
      createElement("button", { onClick: onCancel }, "Cancel crop"),
    ),
}));

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

async function writeNote(value: string) {
  const note = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, value);
    note.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pickPhoto() {
  const picker = container.querySelector('input[type="file"]')!;
  Object.defineProperty(picker, "files", {
    configurable: true,
    value: [new File(["raw"], "pint.jpg", { type: "image/jpeg" })],
  });
  await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  photos.read.mockReset();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:preview");
    static revokeObjectURL = vi.fn();
  });
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

  it.each(["visits", "logbook"])("keeps a selected photo visible when the empty %s read arrives", async (pendingRead) => {
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
    await pickPhoto();
    const picker = container.querySelector('input[type="file"]');
    expect(picker).not.toBeNull();

    await act(async () => pending.resolve(pendingRead === "visits" ? emptyVisits() : emptyLog()));

    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector('input[type="file"]')).toBe(picker);
    expect(button("Use photo")).toBeDefined();
    await act(async () => button("Cancel crop").click());
    expect(container.querySelector("details")?.open).toBe(false);
  });

  it.each(["photos", "logbook"])("protects an edited visit date when the empty %s read arrives", async (pendingRead) => {
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
    const date = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    const today = date.value;
    const yesterday = new Date(`${today}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const editedDate = yesterday.toISOString().slice(0, 10);
    async function changeDate(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(date, value);
        date.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await changeDate(editedDate);
    await act(async () => pending.resolve(pendingRead === "photos" ? emptyPhotos() : emptyLog()));
    expect(container.querySelector("details")?.open).toBe(true);
    expect(date.value).toBe(editedDate);
    await act(async () => button("Add visit account").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Add one thing you found on the visit.");
    await changeDate(today);
    expect(container.querySelector("details")?.open).toBe(false);
    await act(async () => container.querySelector("summary")!.click());
    await changeDate("");
    expect(container.querySelector("details")?.open).toBe(true);
    await changeDate(today);
    expect(container.querySelector("details")?.open).toBe(false);
    await act(async () => container.querySelector("summary")!.click());
    await changeDate(editedDate);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close visit report"]')!.click());
    expect(container.querySelector("details")?.open).toBe(false);
  });

  it("folds empty sections after a successful logbook retry", async () => {
    const retry = deferredResponse();
    photos.read.mockResolvedValue(emptyPhotos());
    let ledgerReads = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.startsWith("/api/ledger/")) {
        ledgerReads += 1;
        return ledgerReads === 1
          ? Promise.resolve(new Response(null, { status: 503 }))
          : retry.promise;
      }
      return Promise.resolve(emptyVisits());
    }));
    await renderCommunity();
    expect(container.querySelector("details")?.open).toBe(true);
    await act(async () => {
      button("Try again").focus();
      button("Try again").click();
    });
    await act(async () => retry.resolve(emptyLog()));
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.querySelector("summary")?.hidden).toBe(false);
  });

  it.each(["Write yours", "Add a photo"])("folds after pending reads with a blank %s composer", async (label) => {
    const pending = deferredResponse();
    photos.read.mockImplementation(() => pending.promise);
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(
      url.startsWith("/api/ledger/") ? emptyLog() : emptyVisits(),
    )));
    await renderCommunity();
    await act(async () => button(label).click());
    await act(async () => pending.resolve(emptyPhotos()));
    expect(container.querySelector("details")?.open).toBe(false);
  });

  it("folds again when the visit note is cleared or its composer is closed", async () => {
    photos.read.mockResolvedValue(emptyPhotos());
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(
      url.startsWith("/api/ledger/") ? emptyLog() : emptyVisits(),
    )));
    await renderCommunity();
    await act(async () => container.querySelector("summary")!.click());
    await act(async () => button("Write yours").click());
    await writeNote("A quiet corner upstairs.");
    expect(container.querySelector("details")?.open).toBe(true);
    await writeNote(" ");
    expect(container.querySelector("details")?.open).toBe(false);
    await act(async () => container.querySelector("summary")!.click());
    await writeNote("A quiet corner upstairs.");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close visit report"]')!.click());
    expect(container.querySelector("details")?.open).toBe(false);
  });

  it.each(["Quiet", "Loud", "Plenty", "Quick"])("protects a visit choice until %s is cleared", async (choice) => {
    const pending = deferredResponse();
    photos.read.mockImplementation(() => pending.promise);
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(
      url.startsWith("/api/ledger/") ? emptyLog() : emptyVisits(),
    )));
    await renderCommunity();
    await act(async () => button("Write yours").click());
    await act(async () => button(choice).click());
    await act(async () => pending.resolve(emptyPhotos()));
    expect(container.querySelector("details")?.open).toBe(true);
    await act(async () => button(choice).click());
    expect(container.querySelector("details")?.open).toBe(false);
  });

  it("protects an accepted crop until the photo draft is cancelled", async () => {
    const pending = deferredResponse();
    photos.read.mockResolvedValue(emptyPhotos());
    vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/ledger/")
      ? pending.promise : Promise.resolve(emptyVisits())));
    await renderCommunity();
    await act(async () => button("Add a photo").click());
    await pickPhoto();
    await act(async () => button("Use photo").click());
    await act(async () => pending.resolve(emptyLog()));
    expect(container.querySelector("details")?.open).toBe(true);
    expect(button("Post photo")).toBeDefined();
    await act(async () => button("Choose a different photo").click());
    await pickPhoto();
    await act(async () => button("Cancel crop").click());
    expect(container.querySelector("details")?.open).toBe(true);
    await act(async () => button("Cancel").click());
    expect(container.querySelector("details")?.open).toBe(false);
  });
});
