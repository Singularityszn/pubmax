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
vi.mock("@/lib/authedFetch", () => ({
  signedInActionFetch: async () => state.read ? state.read() : Response.json({ mates: state.mates }),
  authedActionFetch: async (_input: string, init: RequestInit) => {
    state.posted.push(JSON.parse(String(init.body)));
    if (state.send) return state.send();
    return Response.json(state.answer, { status: 201 });
  },
}));

import SummonMatesDialog from "@/components/map/inspector/SummonMatesDialog";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import type { Venue } from "@/lib/venues";

const venue = { id: "pub-lamb", name: "The Lamb", kind: "pub" } as Venue;

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
});
