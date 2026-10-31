// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PlanNightPresentation, { MysteryStopTitle, PlanMysteryControls } from "@/components/plan/PlanNightPresentation";
import { planRevealScope } from "@/lib/planPresentation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = "11111111-1111-4111-8111-111111111111";
let enabled: boolean;
let revision: number;
let canEdit: boolean;
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
const response = () => Response.json({ memberId: "member-a", canEdit, mysteryEnabled: enabled, routeRevision: revision });
const render = (node: ReactNode) => act(async () => root.render(node));
const buttons = (name: string) => [...container.querySelectorAll("button")].filter((node) => node.textContent?.trim() === name);
function button(name: string) { const found = buttons(name)[0]; if (!found) throw new Error(`Missing button: ${name}`); return found; }
const click = (name: string) => act(async () => button(name).click());

function Night({ ownerKey = "account-a:1", rev = 1 }: { ownerKey?: string; rev?: number }) {
  return <PlanNightPresentation planId={id} memberToken="test-capability" ownerKey={ownerKey} revision={rev}>
    <PlanMysteryControls />
    <MysteryStopTitle venueId="first" name="First pub" position={0} />
    <MysteryStopTitle venueId="second" name="Second pub" position={1} />
    <MysteryStopTitle venueId="third" name="Third pub" position={2} />
  </PlanNightPresentation>;
}

beforeEach(() => {
  sessionStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  enabled = true; revision = 1; canEdit = true;
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") enabled = JSON.parse(String(init.body)).mysteryEnabled;
    return response();
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("reveals stops and the full route without changing the Plan or recording arrivals", async () => {
  await render(<Night />);
  await click("Open stop 2");
  expect(container.textContent).toContain("Second pub");
  await click("Show full route");
  expect(container.textContent).toContain("Third pub");
  expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it("shares device reveals between views and preserves them when the overlay closes", async () => {
  await render(<><Night key="plan" /><Night key="overlay" /></>);
  await click("Open stop 2");
  expect(buttons("Open stop 2")).toHaveLength(0);
  await render(<><Night key="plan" /></>);
  expect(container.textContent).toContain("Second pub");
  expect(buttons("Open stop 2")).toHaveLength(0);
});

it("clears reveals when the account or route revision changes", async () => {
  await render(<Night />);
  await click("Open stop 2");
  const oldKey = planRevealScope(id, "member-a", "account-a:1", 1);
  expect(sessionStorage.getItem(oldKey)).toContain("second");
  revision = 2;
  await render(<Night ownerKey="account-b:2" rev={2} />);
  expect(buttons("Open stop 2")).toHaveLength(1);
  expect(sessionStorage.getItem(oldKey)).toBeNull();
});

it("never restores host controls from a failed write after a newer read revokes access", async () => {
  await render(<Night />);
  let rejectWrite: (response: Response) => void = () => undefined;
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => init?.method === "PUT"
    ? new Promise<Response>((resolve) => { rejectWrite = resolve; })
    : Promise.resolve(Response.json({ error: "forbidden" }, { status: 403 })));
  await click("Turn off mystery envelopes");
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(buttons("Retry settings")).toHaveLength(1);
  await act(async () => rejectWrite(Response.json({ error: "forbidden" }, { status: 403 })));
  expect(buttons("Turn off mystery envelopes")).toHaveLength(0);
  expect(buttons("Turn on mystery envelopes")).toHaveLength(0);
});

it("saves the host setting once and gives guests no setting control", async () => {
  enabled = false;
  await render(<Night />);
  await click("Turn on mystery envelopes");
  expect(buttons("Open stop 2")).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(1);
  canEdit = false;
  await render(<Night ownerKey="guest:2" />);
  expect(buttons("Turn off mystery envelopes")).toHaveLength(0);
  expect(buttons("Open stop 2")).toHaveLength(1);
});

it("offers retry when a read or write body never settles", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(() => Promise.resolve({ ok: true, json: () => new Promise(() => undefined) }));
  await render(<Night />);
  await act(async () => vi.advanceTimersByTimeAsync(8_001));
  expect(buttons("Retry settings")).toHaveLength(1);
  fetchMock.mockImplementation(async () => response());
  await click("Retry settings");
  fetchMock.mockImplementation(() => Promise.resolve({ ok: true, json: () => new Promise(() => undefined) }));
  await click("Turn off mystery envelopes");
  await act(async () => vi.advanceTimersByTimeAsync(8_001));
  expect(buttons("Retry settings")).toHaveLength(1);
  expect(buttons("Saving…")).toHaveLength(0);
});
