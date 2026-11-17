// @vitest-environment jsdom

// The passport sections render nothing they have nothing for: the taste card
// with no stored fact, the overlap with two empty rows.

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ get: vi.fn(), action: vi.fn(), json: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: reads.get, authedActionFetch: reads.action, authedActionJson: reads.json }));
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: auth.user }) }));

import { deleteDiaryEntry } from "@/components/diary/diaryClient";
import { usePassportRead } from "@/components/profile/PassportData";
import { emitBeenHereChanged } from "@/lib/beenHere";
import PassportSections, { PassportOverlapRows, PassportTasteCard } from "@/components/profile/PassportSections";
import { setProviderIdentity } from "@/lib/authProviderRevision";

const roots: Array<{ unmount(): void }> = [];

function render(element: React.ReactElement): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(element));
  return host;
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  auth.user = null;
  reads.get.mockReset();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PassportTasteCard", () => {
  it("renders nothing when no fact is stored", () => {
    expect(render(createElement(PassportTasteCard, { facts: [] })).innerHTML).toBe("");
  });

  it("prints each fact with its day", () => {
    const host = render(
      createElement(PassportTasteCard, {
        facts: [{ key: "drink", label: "Most logged drink", value: "Guinness, logged 2 times", date: "2026-09-30" }],
      }),
    );
    expect(host.textContent).toContain("Your taste, in facts");
    expect(host.textContent).toContain("Guinness, logged 2 times");
    expect(host.textContent).toMatch(/30 Sept? 2026/);
  });
});

describe("PassportOverlapRows", () => {
  it("renders nothing when both rows are empty", () => {
    expect(render(createElement(PassportOverlapRows, { overlap: { topFive: [], wantToTry: [] } })).innerHTML).toBe("");
  });

  it("leaves out an empty row and prints no figure", () => {
    const host = render(
      createElement(PassportOverlapRows, {
        overlap: { topFive: [], wantToTry: [{ venueId: "lamb", venueName: "The Lamb" }] },
      }),
    );
    expect(host.textContent).toContain("Pubs you both want to try");
    expect(host.textContent).not.toContain("top five");
    expect(host.textContent).not.toMatch(/\d|%/);
  });
});

function PointsProbe({ handle }: { handle: string }) {
  const body = usePassportRead<{ total: number; lines: unknown[] }>("points", handle);
  return createElement("output", null, body?.total ?? "loading");
}

function points(total: number): Response {
  return new Response(JSON.stringify({ total, lines: [] }), { status: 200 });
}

describe("passport points refresh", () => {
  it("refreshes mounted points after a successful diary deletion", async () => {
    reads.get.mockResolvedValueOnce(points(120)).mockResolvedValueOnce(points(60));
    reads.action.mockResolvedValueOnce(new Response(null, { status: 200 }));
    let host!: HTMLDivElement;
    await act(async () => { host = render(createElement(PointsProbe, { handle: "deletion-owner" })); });
    expect(host.textContent).toBe("120");
    await act(async () => { expect(await deleteDiaryEntry("owner-entry")).toEqual({ ok: true }); });
    expect(host.textContent).toBe("60");
  });

  it("does not reuse an older in-flight read after a Been-here change", async () => {
    let finishOld!: (response: Response) => void;
    reads.get.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(points(70));
    const host = render(createElement(PointsProbe, { handle: "revision-owner" }));
    await act(async () => { emitBeenHereChanged(); });
    expect(host.textContent).toBe("70");
    await act(async () => { finishOld(points(10)); });
    expect(host.textContent).toBe("70");
  });
});

function ranked(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    venueId: `pub-${index}`,
    venueName: `The Pub ${index}`,
    band: "loved",
    place: index + 1,
    score: 10 - index / 4,
  }));
}

/** Answers the ranking read with each answer in turn; every other passport read is empty. */
function rankingReads(...answers: Array<() => Promise<Response>>) {
  reads.get.mockImplementation((url: string) => {
    if (url === "/api/social/rankings") return (answers.shift() ?? (() => new Promise<Response>(() => {})))();
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
}

function rankingJson(body: unknown, status = 200) {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

async function renderOwner(): Promise<HTMLDivElement> {
  let host!: HTMLDivElement;
  await act(async () => {
    host = render(createElement(PassportSections, { handle: "owner", isOwner: true }));
  });
  for (let i = 0; i < 4; i += 1) await act(async () => {});
  return host;
}

function firstTen(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role=group][aria-labelledby]");
}

async function openFirstTen() {
  await act(async () => {
    firstTen()!.querySelector("button")!.click();
    await import("@/components/social/ComparePubFlow");
  });
}

describe("first ten ranking on the owner's profile", () => {
  it("counts the saved pubs and offers to keep going", async () => {
    auth.user = { id: "owner-account" };
    setProviderIdentity("supabase", "owner-account");
    rankingReads(rankingJson({ entries: ranked(3) }));
    await renderOwner();
    expect(firstTen()?.textContent).toContain("Rank your first ten");
    expect(firstTen()?.textContent).toContain("3 of 10 ranked");
    expect(firstTen()?.querySelector("button")?.textContent).toBe("Keep ranking");
  });

  it("offers nothing once ten are saved", async () => {
    auth.user = { id: "owner-account" };
    rankingReads(rankingJson({ entries: ranked(10) }));
    const host = await renderOwner();
    expect(host.textContent).toContain("The Pub 9");
    expect(firstTen()).toBeNull();
  });

  it("shows a refused read as nothing, never as an empty list", async () => {
    auth.user = { id: "under-age-account" };
    rankingReads(rankingJson({ code: "SOCIAL_ADULT_VERIFICATION_REQUIRED" }, 403));
    const host = await renderOwner();
    expect(host.textContent).not.toContain("Your pubs, ranked");
    expect(host.textContent).not.toContain("0 of 10");
    expect(firstTen()).toBeNull();
  });

  it.each(["RANKING_UNAVAILABLE", "SOCIAL_ACCESS_UNAVAILABLE"])("shows a retryable %s read with a way to read it again", async (code) => {
    auth.user = { id: "owner-account" };
    rankingReads(rankingJson({ code, retryable: true }, 503), rankingJson({ entries: [] }));
    const host = await renderOwner();
    expect(host.textContent).toContain("Your ranking is unavailable right now.");
    expect(host.textContent).not.toContain("0 of 10");
    const retry = [...host.querySelectorAll("button")].find((node) => node.textContent === "Try again")!;
    await act(async () => retry.click());
    for (let i = 0; i < 4; i += 1) await act(async () => {});
    expect(firstTen()?.textContent).toContain("0 of 10 ranked");
    expect(firstTen()?.querySelector("button")?.textContent).toBe("Start ranking");
  });

  it.each([{}, { entries: null }])("does not present an incomplete answer as an empty ranking: %j", async (body) => {
    auth.user = { id: "owner-account" };
    rankingReads(rankingJson(body));
    const host = await renderOwner();
    expect(host.querySelector("[role=status]")?.textContent).toContain("unavailable");
    expect(firstTen()).toBeNull();
  });

  it.each([401, 403])("hides the saved list when a later null-body read refuses access (%s)", async (status) => {
    auth.user = { id: "owner-account" };
    rankingReads(rankingJson({ entries: ranked(2) }), rankingJson(null, status));
    const host = await renderOwner();
    await openFirstTen();
    await act(async () => document.querySelector<HTMLButtonElement>("[aria-label=Close]")!.click());
    expect(host.textContent).not.toContain("The Pub 1");
    expect(firstTen()).toBeNull();
  });

  it("closes an open session and drops the old read when the account changes", async () => {
    auth.user = { id: "owner-account" };
    setProviderIdentity("supabase", "owner-account");
    rankingReads(rankingJson({ entries: ranked(2) }));
    const host = await renderOwner();
    await openFirstTen();
    expect(document.querySelector("[role=dialog]")).not.toBeNull();

    auth.user = { id: "other-account" };
    await act(async () => {
      setProviderIdentity("supabase", "other-account");
    });
    for (let i = 0; i < 4; i += 1) await act(async () => {});
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(host.textContent).not.toContain("The Pub 1");
  });
});
