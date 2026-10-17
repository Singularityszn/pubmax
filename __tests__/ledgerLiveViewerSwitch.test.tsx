// @vitest-environment jsdom

// The Ledger's live half carries the reader's OWN unredacted Family Table rows.
// When the session changes on the same page (sign-out, account switch), the
// previous reader's rows must leave the screen at once, not when the next read
// lands: a slow or hung read would otherwise show them to whoever is now
// holding the device.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ token: "token-author" as string | null }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    session: auth.token ? { access_token: auth.token } : null,
    loading: false,
  }),
}));

import { LedgerLiveProvider, LedgerLogSections } from "@/components/ledger/LedgerLive";

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
      <LedgerLogSections
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
