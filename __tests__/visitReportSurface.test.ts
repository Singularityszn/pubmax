// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VisitReportPanel, {
  VISIT_REPORT_PEEK_LIMIT,
  visitReportComposerMode,
  visitReportEmptyCopy,
  visitReportPeekAffordanceLabel,
  visitReportsForPanel,
} from "@/components/visits/VisitReportPanel";
import type { VisitReportDTO } from "@/lib/visitReports";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  session: null as { access_token: string; user: { id: string } } | null,
  rejected: null as import("@/lib/accountBoundFetch").AccountAuthSnapshot | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: authState.user,
    session: authState.session,
    contributionAuth: authState.session && !authState.rejected
      ? { userId: authState.session.user.id, accessToken: authState.session.access_token }
      : null,
    rejectedContributionAuth: authState.rejected,
    invalidateContributionAuth: (auth: import("@/lib/accountBoundFetch").AccountAuthSnapshot) => {
      authState.rejected = auth;
    },
  }),
}));

function reportStub(id: string): VisitReportDTO {
  return {
    id,
    venueId: "venue-1",
    handle: `drinker-${id}`,
    visitedAt: "2026-08-01",
    createdAt: "2026-08-01T12:00:00.000Z",
    busyness: null,
    noise: null,
    seating: null,
    serviceWait: null,
    note: `Account ${id}`,
  };
}

describe("Visit Report venue surface", () => {
  it("closes authoring fields when an open composer loses its account", () => {
    expect(visitReportComposerMode(true, "account-1")).toBe("open");
    expect(visitReportComposerMode(true, null)).toBe("sign_in_required");
  });

  it("asks a signed-out visitor to sign in before mounting any report fields", () => {
    authState.user = null;
    authState.session = null;

    const html = renderToStaticMarkup(
      createElement(VisitReportPanel, {
        venueId: "venue-1",
        venueName: "The Crown",
      }),
    );

    expect(html).toContain("Sign in to contribute");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("<textarea");
  });

  it("limits the Overview peek to the newest one or two accounts", () => {
    const reports = [
      reportStub("a"),
      reportStub("b"),
      reportStub("c"),
    ];

    expect(VISIT_REPORT_PEEK_LIMIT).toBe(2);
    expect(visitReportsForPanel(reports, "peek")).toEqual(reports.slice(0, 2));
    expect(visitReportsForPanel(reports, "full")).toEqual(reports);
  });

  it("never collapses a failed peek read into an empty visits claim", () => {
    expect(visitReportEmptyCopy("ready")).toBe(
      "No visits have been written up here yet.",
    );
    expect(visitReportEmptyCopy("degraded")).toBe(
      "We couldn't check the visit notes here just now.",
    );
    expect(visitReportEmptyCopy("degraded")).not.toMatch(/no visits/i);
    expect(visitReportPeekAffordanceLabel({ status: "degraded", reports: [] })).toBe(
      "Open Lore",
    );
    expect(visitReportPeekAffordanceLabel({ status: "ready", reports: [] })).toBe(
      "Write yours on Lore",
    );
    expect(
      visitReportPeekAffordanceLabel({
        status: "ready",
        reports: [reportStub("a")],
      }),
    ).toBe("More on Lore");
  });

  it("keeps the Overview peek free of the composer fields", () => {
    authState.user = null;
    authState.session = null;

    const html = renderToStaticMarkup(
      createElement(VisitReportPanel, {
        venueId: "venue-1",
        venueName: "The Crown",
        mode: "peek",
        onOpenFull: () => {},
      }),
    );

    expect(html).toContain("visitReportPanel--peek");
    expect(html).toContain("Open Lore");
    expect(html).not.toContain("Sign in to contribute");
    expect(html).not.toContain("Write yours");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("<textarea");
  });
});

vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => undefined }));

let host: HTMLDivElement;
let root: Root;
let reports: VisitReportDTO[];
let writes: Array<{ body: Record<string, unknown>; authorization: string | null }>;
let writeStatus: number;
let reads: string[];

function signIn(id: string) {
  authState.user = { id };
  authState.session = { access_token: `token-${id}`, user: { id } };
  authState.rejected = null;
}

async function mount(active = true, mode: "full" | "peek" = "full", onOpenFull?: () => void) {
  await act(async () => {
    root.render(createElement(VisitReportPanel, {
      venueId: "venue-1", venueName: "The Crown", active, mode, onOpenFull,
    }));
  });
}

async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}

async function edit(selector: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  expect(field, selector).not.toBeNull();
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field!.dispatchEvent(new Event("input", { bubbles: true }));
    field!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
  authState.user = null;
  authState.session = null;
  authState.rejected = null;
  reports = [];
  writes = [];
  reads = [];
  writeStatus = 200;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      expect(String(input)).toBe("/api/visit-reports");
      writes.push({
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
        authorization: new Headers(init.headers).get("authorization"),
      });
      return new Response(JSON.stringify(writeStatus === 401
        ? { status: "sign_in_required", error: "Sign in to contribute." }
        : {}), { status: writeStatus, headers: { "content-type": "application/json" } });
    }
    expect(String(input)).toBe("/api/visit-reports?venueId=venue-1");
    reads.push(String(input));
    return new Response(JSON.stringify({ status: "ready", reports }), {
      headers: { "content-type": "application/json" },
    });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mounted Visit Report interactions", () => {
  it("keeps drafts private to each account and closes fields after sign-out", async () => {
    signIn("alice");
    await mount();
    await click("Write a visit");
    await edit("textarea", "Alice's quiet corner");
    signIn("bob");
    await mount();
    expect(host.querySelector("textarea")).toBeNull();
    await click("Write a visit");
    expect(host.querySelector("textarea")?.value).toBe("");
    await edit("textarea", "Bob's visit");
    signIn("alice");
    await mount();
    await click("Write a visit");
    expect(host.querySelector("textarea")?.value).toBe("Alice's quiet corner");
    authState.user = null;
    authState.session = null;
    await mount();
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector('input[type="date"]')).toBeNull();
    expect(writes).toEqual([]);
  });

  it("submits one dated observation with the account token and no claimed handle", async () => {
    signIn("alice");
    await mount();
    await click("Write a visit");
    const date = host.querySelector<HTMLInputElement>('input[type="date"]');
    expect(date?.min).toBe("2026-08-26");
    expect(date?.max).toBe("2026-11-24");
    expect(host.querySelector("textarea")?.maxLength).toBe(140);
    await edit('input[type="date"]', "2026-11-23");
    await click("Quiet");
    await edit("textarea", "Found a seat");
    await click("Add visit account");
    expect(writes).toEqual([{
      body: { venueId: "venue-1", visitedAt: "2026-11-23", busyness: "quiet", noise: null, seating: null, serviceWait: null, note: "Found a seat" },
      authorization: "Bearer token-alice",
    }]);
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("Saved.");
  });

  it.each(["2026-08-25", "2026-11-25"])("refuses a visit outside the 90-day window: %s", async (day) => {
    signIn("alice");
    await mount();
    await click("Write a visit");
    await edit("textarea", "A visit");
    await edit('input[type="date"]', day);
    await click("Add visit account");
    expect(writes).toEqual([]);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Pick the day");
  });

  it("closes an expired-session composer and prevents another write", async () => {
    signIn("alice");
    await mount();
    await click("Write a visit");
    await edit("textarea", "A visit");
    writeStatus = 401;
    await click("Add visit account");
    expect(writes).toHaveLength(1);
    expect(host.querySelector("textarea")).toBeNull();
    expect(document.body.textContent).toContain("Your sign-in expired");
    await click("Sign in to write a visit");
    expect(writes).toHaveLength(1);
  });

  it("defers reads while inactive, keeps a draft, and refreshes on return", async () => {
    signIn("alice");
    await mount(false);
    expect(reads).toEqual([]);
    expect(host.textContent).toContain("Checking visit notes.");
    await mount(true);
    expect(host.textContent).not.toContain("Checking visit notes.");
    await click("Write a visit");
    await edit("textarea", "Still writing");
    await mount(false);
    expect(reads).toHaveLength(1);
    reports = [reportStub("new")];
    await mount(true);
    expect(host.querySelector("textarea")?.value).toBe("Still writing");
    expect(host.querySelector("article")?.textContent).toContain("Account new");
    expect(reads).toHaveLength(2);
  });

  it("shows individual report actions in full mode and a read-only peek with a working way to Lore", async () => {
    reports = [reportStub("a"), reportStub("b"), reportStub("c")];
    const open = vi.fn();
    await mount(true, "peek", open);
    expect(host.querySelectorAll("article")).toHaveLength(2);
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector(".visitReportFlag")).toBeNull();
    await click("More on Lore");
    expect(open).toHaveBeenCalledOnce();
    await mount(true, "full");
    expect(host.querySelectorAll("article")).toHaveLength(3);
    const firstFlag = host.querySelector<HTMLButtonElement>(".visitReportFlag");
    expect(firstFlag).not.toBeNull();
    await act(async () => firstFlag!.click());
    expect(writes).toEqual([{ body: { action: "report", id: "a" }, authorization: null }]);
    expect(firstFlag?.disabled).toBe(true);
  });
});
