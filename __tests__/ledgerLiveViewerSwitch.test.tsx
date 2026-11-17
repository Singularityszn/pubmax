// @vitest-environment jsdom

// The Ledger's live half carries the reader's OWN unredacted Family Table rows.
// When the session changes on the same page (sign-out, account switch), the
// previous reader's rows must leave the screen at once, not when the next read
// lands: a slow or hung read would otherwise show them to whoever is now
// holding the device.

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ token: "token-author" as string | null }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    session: auth.token ? { access_token: auth.token } : null,
    loading: false,
  }),
}));

const community = vi.hoisted(() => ({ visitsEmpty: true, photosEmpty: true }));
vi.mock("@/components/visits/VisitReportPanel", () => ({
  default: function MockVisitReports({ onEmptyChange }: { onEmptyChange: (empty: boolean) => void }) {
    useEffect(() => onEmptyChange(community.visitsEmpty), [onEmptyChange]);
    return <div>Visit reports</div>;
  },
}));
vi.mock("@/components/venue/VenuePhotoWall", () => ({
  default: function MockPhotoWall({ onEmptyChange }: { onEmptyChange: (empty: boolean) => void }) {
    useEffect(() => onEmptyChange(community.photosEmpty), [onEmptyChange]);
    return <div>Photo wall</div>;
  },
}));

import { LedgerCommunity, LedgerLiveProvider } from "@/components/ledger/LedgerLive";
import type { VenueClaim } from "@/lib/curation";

const AUTHOR_LOG = {
  claims: [],
  entries: [],
  familyEntries: [
    {
      id: "legacy-1",
      handle: "@grandad_bert",
      note: "Grandad proposed here in 1962.",
      priceLabel: "",
      dateLabel: "1 September 2026",
      createdAt: "2026-09-01T20:00:00.000Z",
      era: "",
      provenance: "contributor",
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

function view() {
  return (
    <LedgerLiveProvider venueId="venue-xjf3n0">
      <LedgerCommunity
        venueId="venue-xjf3n0"
        venueName="The Test Arms"
        ledgerUrl="/ledger/venue-xjf3n0"
        curatedClaims={[]}
      />
    </LedgerLiveProvider>
  );
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  auth.token = "token-author";
  community.visitsEmpty = true;
  community.photosEmpty = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the Ledger's live half when the reader changes", () => {
  it("drops the previous reader's Family Table rows before the next read lands", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization");
      if (authorization === "Bearer token-author") {
        return Promise.resolve(new Response(JSON.stringify(AUTHOR_LOG), { status: 200 }));
      }
      // The next reader's read never answers.
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(view()));
    await settle();
    expect(container.textContent).toContain("1962");

    auth.token = null;
    await act(async () => root.render(view()));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("1962");
    expect(container.textContent).toContain("Opening the logbook.");
  });
});

describe("the Ledger's empty community sections", () => {
  it("keeps the pub's story visible outside the folded empty contributions", async () => {
    const claims: VenueClaim[] = [{
      kind: "sourced",
      label: "Heritage",
      content: "The pub opened in 1842.",
    }];
    let answer!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
    await act(async () => root.render(
      <LedgerLiveProvider venueId="venue-xjf3n0">
        <LedgerCommunity venueId="venue-xjf3n0" venueName="The Test Arms" ledgerUrl="/ledger/venue-xjf3n0" curatedClaims={claims} />
      </LedgerLiveProvider>,
    ));

    expect(container.querySelector('[aria-labelledby="ledgerClaimsHeading"]')?.closest("details")).toBeNull();
    expect(container.textContent).toContain("The pub opened in 1842.");
    expect(container.querySelector("details")?.open).toBe(true);

    await act(async () => answer(new Response(JSON.stringify({ claims, entries: [], familyEntries: [] }), { status: 200 })));

    const group = container.querySelector("details");
    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(group?.open).toBe(false);
    expect(group?.querySelector("summary")?.hidden).toBe(false);
    expect(group?.querySelector("summary")?.textContent).toBe("Be the first to log here");
    expect(container.querySelectorAll('[aria-labelledby="ledgerClaimsHeading"]')).toHaveLength(1);
    expect(container.querySelector('[aria-labelledby="ledgerClaimsHeading"]')?.closest("details")).toBeNull();
    expect(container.textContent).toContain("The pub opened in 1842.");
  });

  it("folds the sections only after every read confirms they are empty", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ claims: [], entries: [], familyEntries: [] }), { status: 200 }))));
    await act(async () => root.render(
      <LedgerLiveProvider venueId="venue-xjf3n0">
        <LedgerCommunity venueId="venue-xjf3n0" venueName="The Test Arms" ledgerUrl="/ledger/venue-xjf3n0" curatedClaims={[]} />
      </LedgerLiveProvider>,
    ));
    const group = container.querySelector("details");
    expect(group?.open).toBe(false);
  });

  it("keeps existing family entries visible", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(AUTHOR_LOG), { status: 200 }))));
    await act(async () => root.render(
      <LedgerLiveProvider venueId="venue-xjf3n0">
        <LedgerCommunity venueId="venue-xjf3n0" venueName="The Test Arms" ledgerUrl="/ledger/venue-xjf3n0" curatedClaims={[]} />
      </LedgerLiveProvider>,
    ));
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.textContent).toContain("1962");
  });

  it("does not call an unavailable logbook empty", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))));
    await act(async () => root.render(
      <LedgerLiveProvider venueId="venue-xjf3n0">
        <LedgerCommunity venueId="venue-xjf3n0" venueName="The Test Arms" ledgerUrl="/ledger/venue-xjf3n0" curatedClaims={[]} />
      </LedgerLiveProvider>,
    ));
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector('button')?.textContent).toContain("Try again");
  });

  it("keeps the sections open when a read cannot confirm an empty result", async () => {
    community.visitsEmpty = false;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ claims: [], entries: [], familyEntries: [] }), { status: 200 }))));
    await act(async () => root.render(
      <LedgerLiveProvider venueId="venue-xjf3n0">
        <LedgerCommunity venueId="venue-xjf3n0" venueName="The Test Arms" ledgerUrl="/ledger/venue-xjf3n0" curatedClaims={[]} />
      </LedgerLiveProvider>,
    ));
    expect(container.querySelector("details")?.open).toBe(true);
    community.visitsEmpty = true;
  });
});
