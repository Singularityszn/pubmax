// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A list a person can only add to turns every slip into clutter they keep.
// Wanted rows open the link the owner saved, take a corrected note and come off
// the list. Diary entries take a corrected day, rating and review and are
// removed. Both go through the owner-only routes, so a row is only ever the
// signed-in account's own.

const auth = vi.hoisted(() => ({
  current: {
    accountRevision: 0,
    supabaseAuthState: "authenticated",
    user: { id: "user-1" },
    getCurrentUserId: () => "user-1",
  },
}));
const authedFetch = vi.hoisted(() => vi.fn());
const authedActionFetch = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch, authedActionFetch }));
vi.mock("@/lib/venueMapUrl", () => ({ venueMapUrl: (id: string) => `/map/${id}` }));
vi.mock("@/components/wanted/WantedPromotionControl", () => ({ default: () => null }));

import DiaryList from "@/components/diary/DiaryList";
import WantedListBody from "@/components/wanted/WantedListBody";
import { setProviderIdentity } from "@/lib/authProviderRevision";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  setProviderIdentity("supabase", "user-1");
  authedFetch.mockReset();
  authedActionFetch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match;
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const wanted = (overrides: Record<string, unknown> = {}) => ({
  id: "wanted-1",
  ownerActor: "profile:1",
  venueKind: "pending",
  venueId: "",
  venueName: "",
  sourceUrl: "https://www.instagram.com/reel/abc123/",
  sourcePlatform: "instagram",
  note: "Saw it on a reel",
  rawPaste: "the one with the red door",
  status: "open",
  createdAt: "2026-10-06T10:00:00.000Z",
  fulfilledAt: null,
  promotedListType: null,
  promotedAt: null,
  ...overrides,
});

describe("Wanted row controls", () => {
  it("opens the saved link in a new tab as a real link", async () => {
    authedFetch.mockResolvedValue(json({ wanteds: [wanted()] }));
    await act(async () => {
      root.render(createElement(WantedListBody));
    });
    await settle();

    const link = [...container.querySelectorAll("a")].find((a) =>
      a.textContent?.startsWith("Open saved link"),
    );
    expect(link?.getAttribute("href")).toBe("https://www.instagram.com/reel/abc123/");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toContain("instagram.com");
  });

  it("does not offer a link for a saved address that is not http or https", async () => {
    authedFetch.mockResolvedValue(json({ wanteds: [wanted({ sourceUrl: "javascript:alert(1)" })] }));
    await act(async () => {
      root.render(createElement(WantedListBody));
    });
    await settle();

    expect([...container.querySelectorAll("a")].some((a) => a.textContent?.startsWith("Open saved link"))).toBe(
      false,
    );
  });

  it("saves a corrected note through the owner route", async () => {
    authedFetch.mockResolvedValue(json({ wanteds: [wanted()] }));
    authedActionFetch.mockResolvedValue(json({ wanted: wanted({ note: "Ask for the snug" }) }));
    await act(async () => {
      root.render(createElement(WantedListBody));
    });
    await settle();

    await act(async () => {
      button("Edit note").click();
    });
    const input = container.querySelector<HTMLInputElement>("#wanted-note-wanted-1")!;
    expect(input.value).toBe("Saw it on a reel");
    await act(async () => {
      type(input, "Ask for the snug");
    });
    await act(async () => {
      button("Save note").click();
    });
    await settle();

    const [url, init] = authedActionFetch.mock.calls[0]! as [string, { body: string }];
    expect(url).toBe("/api/wanted");
    expect(JSON.parse(init.body)).toEqual({ action: "note", id: "wanted-1", note: "Ask for the snug" });
    expect(container.textContent).toContain("Ask for the snug");
    expect(container.querySelector("#wanted-note-wanted-1")).toBeNull();
  });

  it("removes a row after the confirm, and keeps it when the confirm is declined", async () => {
    authedFetch.mockResolvedValue(json({ wanteds: [wanted()] }));
    authedActionFetch.mockResolvedValue(json({ ok: true }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await act(async () => {
      root.render(createElement(WantedListBody));
    });
    await settle();

    await act(async () => {
      button("Remove").click();
    });
    expect(authedActionFetch).not.toHaveBeenCalled();
    expect(container.querySelectorAll("li.wantedRow")).toHaveLength(1);

    await act(async () => {
      button("Remove").click();
    });
    await settle();

    expect(confirm).toHaveBeenCalledTimes(2);
    const [, init] = authedActionFetch.mock.calls[0]! as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ action: "delete", id: "wanted-1" });
    expect(container.querySelectorAll("li.wantedRow")).toHaveLength(0);
    expect(container.textContent).toContain("No open Wanted places yet.");
  });

  it("says so, and keeps the row, when the removal fails", async () => {
    authedFetch.mockResolvedValue(json({ wanteds: [wanted()] }));
    authedActionFetch.mockResolvedValue(json({ error: "Storage is unavailable." }, 503));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      root.render(createElement(WantedListBody));
    });
    await settle();

    await act(async () => {
      button("Remove").click();
    });
    await settle();

    expect(container.querySelectorAll("li.wantedRow")).toHaveLength(1);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Storage is unavailable.");
  });
});

describe("Diary entry controls", () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    id: "entry-1",
    ownerUserId: "user-1",
    venueId: "venue-dove",
    venueName: "The Dove",
    visitedOn: "2026-10-04",
    rating: 3,
    review: "First go.",
    visibility: "private",
    createdAt: "2026-10-04T21:00:00.000Z",
    ...overrides,
  });

  it("corrects the review and day of an entry and shows the saved row", async () => {
    authedFetch.mockResolvedValue(json({ status: "ready", entries: [entry()] }));
    authedActionFetch.mockResolvedValue(
      json({ entry: entry({ review: "Better the second time.", visitedOn: "2026-10-05" }) }),
    );
    await act(async () => {
      root.render(createElement(DiaryList));
    });
    await settle();

    await act(async () => {
      button("Edit").click();
    });
    const date = container.querySelector<HTMLInputElement>("input[type=date]")!;
    const review = container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(date.value).toBe("2026-10-04");
    expect(review.value).toBe("First go.");
    await act(async () => {
      type(date, "2026-10-05");
      type(review, "Better the second time.");
    });
    await act(async () => {
      button("Save changes").click();
    });
    await settle();

    const [url, init] = authedActionFetch.mock.calls[0]! as [string, { body: string }];
    expect(url).toBe("/api/diary");
    expect(JSON.parse(init.body)).toEqual({
      action: "update",
      id: "entry-1",
      visitedOn: "2026-10-05",
      rating: 3,
      review: "Better the second time.",
    });
    expect(container.textContent).toContain("Better the second time.");
    expect(container.querySelector("[data-testid=diary-entry-edit]")).toBeNull();
  });

  it("keeps the editor open with the server's line when a correction is refused", async () => {
    authedFetch.mockResolvedValue(json({ status: "ready", entries: [entry()] }));
    authedActionFetch.mockResolvedValue(
      json({ error: "You already logged this pub for that day.", code: "DIARY_ENTRY_EXISTS" }, 409),
    );
    await act(async () => {
      root.render(createElement(DiaryList));
    });
    await settle();

    await act(async () => {
      button("Edit").click();
    });
    await act(async () => {
      button("Save changes").click();
    });
    await settle();

    expect(container.querySelector("[data-testid=diary-entry-edit]")).not.toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "You already logged this pub for that day.",
    );
  });

  it("removes an entry after the confirm", async () => {
    authedFetch.mockResolvedValue(
      json({ status: "ready", entries: [entry(), entry({ id: "entry-2", venueName: "The Lamb", visitedOn: "2026-10-01" })] }),
    );
    authedActionFetch.mockResolvedValue(json({ ok: true }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      root.render(createElement(DiaryList));
    });
    await settle();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Remove your diary entry for The Dove']")!
        .click();
    });
    await settle();

    const [, init] = authedActionFetch.mock.calls[0]! as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ action: "delete", id: "entry-1" });
    const rows = container.querySelectorAll("[data-testid=diary-entry]");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("The Lamb");
  });
});
