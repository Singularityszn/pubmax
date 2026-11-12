// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Summon mates: the dialog lists only the mates the server answers, posts the
// mates the person ticked, and its receipt names only the mates the server says
// it reached.

const state = vi.hoisted(() => ({
  phase: "signed-in" as "signed-in" | "signed-out",
  mates: [] as string[],
  posted: [] as unknown[],
  answer: { sent: [] as string[], failed: [] as string[] },
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
  ContributionGateDialog: () => null,
}));
vi.mock("@/lib/authedFetch", () => ({
  signedInActionFetch: async () => Response.json({ mates: state.mates }),
  authedActionFetch: async (_input: string, init: RequestInit) => {
    state.posted.push(JSON.parse(String(init.body)));
    return Response.json(state.answer, { status: 201 });
  },
}));

import SummonMatesDialog from "@/components/map/inspector/SummonMatesDialog";
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
  state.mates = [];
  state.posted = [];
  state.answer = { sent: [], failed: [] };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SummonMatesDialog", () => {
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
