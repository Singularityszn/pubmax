// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Summon mates: the dialog lists only the mates the server answers, posts the
// mates the person ticked, and its receipt names only the mates the server says
// it reached.

const state = vi.hoisted(() => ({
  phase: "signed-in" as "signed-in" | "signed-out",
  identityResolved: true,
  mates: [] as string[],
  posted: [] as unknown[],
  answer: { sent: [] as string[], failed: [] as string[] },
  read: null as null | (() => Promise<Response | null>),
  send: null as null | (() => Promise<Response>),
  reads: 0,
  warm: null as unknown,
  detail: { status: "missing" } as unknown,
  shared: [] as Array<{ title: string; text: string; url: string }>,
  shareOutcome: "shared" as "shared" | "cancelled" | "whatsapp" | "failed",
  copied: [] as string[],
}));

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({ identityResolved: state.identityResolved }),
}));
vi.mock("@/lib/authClient", () => ({
  getAccessToken: async () => "test-token",
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: state.phase,
    signedIn: state.phase === "signed-in",
    signedOut: state.phase === "signed-out",
    unresolved: false,
  }),
}));
vi.mock("@/components/identity/ContributionGateDialog", () => ({
  ContributionGateDialog: ({ mode, onAsserted }: { mode: string; onAsserted: () => void }) =>
    createElement("button", { "data-gate": mode, onClick: onAsserted }, "Complete gate"),
}));
vi.mock("@/lib/warmVenueDetail", () => ({
  getWarmedVenue: () => state.warm,
  warmVenueDetail: async () => state.detail,
}));
vi.mock("@/lib/shareSheet", () => ({
  shareNightObject: async (payload: { title: string; text: string; url: string }) => {
    state.shared.push(payload);
    return state.shareOutcome;
  },
}));
vi.mock("@/lib/authedFetch", () => ({
  signedInActionFetch: async () => {
    state.reads += 1;
    return state.read ? state.read() : Response.json({ mates: state.mates });
  },
  authedActionFetch: async (_input: string, init: RequestInit) => {
    state.posted.push(JSON.parse(String(init.body)));
    if (state.send) return state.send();
    return Response.json(state.answer, { status: 201 });
  },
}));

import SummonMatesDialog from "@/components/map/inspector/SummonMatesDialog";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

const venue = { id: "pub-lamb", name: "The Lamb", kind: "pub" } as Venue;
const SOURCE = "https://www.pint-prices.com/pub/94%20Lamb's%20Conduit%20Street/The%20Lamb";
const STATEMENT = "£4.50 for members, Monday to Thursday before 7pm";
const PRICE_LINE = `Pint Prices listed Amstel (pint) as "${STATEMENT}", read 9 November 2026. Source: ${SOURCE}`;

/** The Lamb as the public detail route answers it, with one conditional listed row. */
function lambDetail(): Venue {
  const [grouped] = groupVenuePrices([{
    app_price_id: "app_price_lamb_1",
    pub_name: "The Lamb",
    pint_name: "Amstel",
    measure: "pint",
    price_gbp: 4.5,
    price_text: STATEMENT,
    address: "94 Lamb's Conduit Street, London, WC1N 3LZ",
    latitude: 51.5226,
    longitude: -0.1188,
    pub_url: SOURCE,
    scraped_at_values: "2026-11-09T13:07:13+00:00",
  } as VenuePrice]);
  return { ...grouped!, id: "pub-lamb" };
}

function preview(): string | null {
  return document.querySelector("[data-summon-preview]")?.textContent ?? null;
}

let container: HTMLDivElement;
let root: Root;

/** Wait for the event, not for time: the read or the send has landed. */
async function until(check: () => unknown): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(check()).toBeTruthy();
  });
}

function button(name: RegExp): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((entry) => name.test(entry.textContent ?? ""));
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  state.phase = "signed-in";
  state.identityResolved = true;
  state.mates = [];
  state.posted = [];
  state.answer = { sent: [], failed: [] };
  state.read = null;
  state.send = null;
  state.reads = 0;
  state.warm = null;
  state.detail = { status: "missing" };
  state.shared = [];
  state.shareOutcome = "shared";
  state.copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => { state.copied.push(text); } },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T18:00:00Z"));
  setProviderIdentity("supabase", "account-a");
  setProviderIdentity("clerk", null);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setProviderIdentity("supabase", null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SummonMatesDialog", () => {
  it.each([false, true])("loads the new account after slow identity resolution (old read pending: %s)", async (pendingRead) => {
    const auth = await vi.importActual<typeof import("@/lib/authedFetch")>("@/lib/authedFetch");
    let finishRead!: (response: Response) => void;
    if (pendingRead) state.read = () => new Promise<Response>((resolve) => { finishRead = resolve; });
    state.mates = ["ann"];
    await act(async () => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));

    vi.useFakeTimers();
    state.identityResolved = false;
    auth.publishAuthActionState({ status: "signed-in", identityResolved: false });
    state.read = () => auth.signedInActionFetch("/api/summon");
    vi.stubGlobal("fetch", async () => Response.json({ mates: ["bo"] }));
    await act(async () => { setProviderIdentity("supabase", "account-b"); });
    if (pendingRead) await act(async () => finishRead(Response.json({ mates: ["ann"] })));
    // The previous live failure exceeded the request helper's two-second readiness window.
    await act(async () => { await vi.advanceTimersByTimeAsync(2_001); });
    expect(document.body.textContent).not.toContain("@ann");
    expect(() => button(/^Sign in$/)).toThrow();

    state.identityResolved = true;
    auth.publishAuthActionState({ status: "signed-in", identityResolved: true });
    await act(async () => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    expect(document.body.textContent).toContain("@bo");
    expect(() => button(/^Sign in$/)).toThrow();
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  });

  it("clears selections and receipts when the provider account changes or signs out", async () => {
    state.mates = ["ann"];
    await act(async () => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    act(() => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    state.mates = ["bo"];
    await act(async () => { setProviderIdentity("supabase", "account-b"); });
    expect(document.body.textContent).not.toContain("@ann");
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(button(/^Send$/).disabled).toBe(true);
    act(() => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    state.answer = { sent: ["bo"], failed: [] };
    await act(async () => button(/Send to 1 mate/).click());
    expect(document.querySelector('[data-summon-outcome="sent"]')).not.toBeNull();
    state.phase = "signed-out";
    await act(async () => { setProviderIdentity("supabase", null); });
    expect(document.querySelector('[data-summon-outcome="sent"]')).toBeNull();
    expect(document.body.textContent).not.toContain("@bo");
    expect(button(/^Sign in$/)).toBeTruthy();
  });

  it.each(["read", "send"] as const)("discards a late %s response after an account change", async (operation) => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    state.mates = ["ann"];
    if (operation === "read") state.read = () => pending;
    await act(async () => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    if (operation === "send") {
      state.send = () => pending;
      act(() => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
      await act(async () => button(/Send to 1 mate/).click());
    }
    state.read = null;
    state.mates = ["bo"];
    await act(async () => { setProviderIdentity("supabase", "account-b"); });
    await act(async () => finish(Response.json(
      operation === "read" ? { mates: ["ann"] } : { sent: ["ann"], failed: [] },
    )));
    expect(document.body.textContent).not.toContain("@ann");
    expect(document.body.textContent).toContain("@bo");
    expect(document.querySelector('[data-summon-outcome="sent"]')).toBeNull();
  });

  it.each([
    ["read", "adult_check_required"],
    ["read", "onboarding_required"],
    ["send", "adult_check_required"],
    ["send", "onboarding_required"],
  ])("opens the %s refusal's %s gate and reloads after assertion", async (operation, gate) => {
    const refusal = () => Promise.resolve(Response.json({
      code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
      error: "Access required",
      details: { gate },
    }, { status: 403 }));
    state.mates = ["ann"];
    if (operation === "read") state.read = refusal;
    else state.send = refusal;
    await act(async () => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    if (operation === "send") {
      act(() => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
      await act(async () => button(/Send to 1 mate/).click());
    }
    expect(document.querySelector('[data-gate]')?.getAttribute("data-gate")).toBe(gate);
    state.read = null;
    state.mates = ["bo"];
    await act(async () => button(/Complete gate/).click());
    expect(document.querySelector('[data-gate]')).toBeNull();
    expect(document.body.textContent).toContain("@bo");
    expect(document.body.textContent).not.toContain("@ann");
  });

  it("sends the ticked mates and names only the ones the server reached", async () => {
    state.mates = ["ann", "bo", "cy"];
    state.answer = { sent: ["ann"], failed: ["cy"] };
    act(() => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    await until(() => document.querySelector('input[type="checkbox"]'));

    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((box) => box.closest("label")?.textContent)).toEqual(["@ann", "@bo", "@cy"]);
    act(() => boxes[0]!.click());
    act(() => boxes[2]!.click());
    const time = document.querySelector<HTMLInputElement>('input[type="time"]')!;
    expect(button(/Send to 2 mates/).disabled).toBe(false);

    act(() => button(/Send to 2 mates/).click());
    await until(() => document.querySelector('[data-summon-outcome="sent"]'));

    expect(state.posted).toEqual([{ venueId: "pub-lamb", time: time.value, mates: ["ann", "cy"] }]);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Sent to @ann. They'll find it in Messages.");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("@cy");
  });

  it("offers a link, and no send, to a reader with no mates or no account", async () => {
    act(() => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    await until(() => document.body.textContent?.includes("No mates to summon yet."));
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(() => button(/^Send/)).toThrow();
    expect(button(/^Share a link$/)).toBeTruthy();

    act(() => root.unmount());
    root = createRoot(container);
    state.phase = "signed-out";
    act(() => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    expect(() => button(/^Send/)).toThrow();
    expect(button(/^Sign in$/)).toBeTruthy();
  });

  it("shows a signed-out reader the dated price from the public detail and shares it whole", async () => {
    state.phase = "signed-out";
    state.detail = { status: "found", venue: lambDetail() };
    await act(async () => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    await until(() => preview());

    expect(preview()).toContain(PRICE_LINE);
    await act(async () => button(/^Share a link$/).click());

    expect(state.reads).toBe(0);
    expect(state.shared).toEqual([{
      title: "The Lamb",
      text: expect.stringContaining(PRICE_LINE),
      url: expect.stringMatching(/\/map\?sel=pub-lamb&meet=/),
    }]);
    expect(state.shared[0]!.text).toMatch(/^Come to The Lamb at \S+\? /);
  });

  it("copies the whole invite and its link when no share sheet opens, and nothing on a cancel", async () => {
    state.phase = "signed-out";
    state.warm = lambDetail();
    state.shareOutcome = "cancelled";
    await act(async () => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    expect(preview()).toContain(PRICE_LINE);

    await act(async () => button(/^Share a link$/).click());
    expect(state.copied).toEqual([]);
    expect(document.querySelector('[role="status"]')).toBeNull();

    state.shareOutcome = "failed";
    await act(async () => button(/^Share a link$/).click());
    const shared = state.shared.at(-1)!;
    expect(state.copied).toEqual([`${shared.text}\n${shared.url}`]);
    expect(state.copied[0]).toContain(PRICE_LINE);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Sharing didn't open, so we copied the invite and link.");
  });

  it("shares no price from a saved device copy or when the detail cannot be read", async () => {
    state.phase = "signed-out";
    state.detail = { status: "found", venue: lambDetail(), savedAt: "2026-11-10T09:00:00Z" };
    await act(async () => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    await act(async () => {});
    expect(preview()).toBeNull();
    await act(async () => button(/^Share a link$/).click());
    expect(state.shared[0]!.text).not.toContain("Pint Prices");
    expect(state.shared[0]!.text).toMatch(/^Come to The Lamb at .+\? It's on the PUBMAXX map\.$/);
  });

  it("posts only the pub, the time and the mates, whatever the preview showed", async () => {
    state.mates = ["ann"];
    state.warm = lambDetail();
    state.answer = { sent: ["ann"], failed: [] };
    await act(async () => root.render(createElement(SummonMatesDialog, { venue, onClose: () => {} })));
    expect(preview()).toContain(PRICE_LINE);
    act(() => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button(/Send to 1 mate/).click());

    expect(state.posted).toEqual([{ venueId: "pub-lamb", time: expect.stringMatching(/^\d{2}:\d{2}$/), mates: ["ann"] }]);
  });
});
