// @vitest-environment jsdom

import { act, Component, createContext, useContext, useState, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createNearPriceEvidencePanel } from "@/components/nearme/NearPriceEvidencePanel";
import * as missionRequests from "@/lib/authedFetch";
import type { NearMeCard } from "@/lib/nearMeAnswer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ identityResolved: true, user: { id: "owner-one" } as { id: string } | null }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
beforeEach(() => { auth.identityResolved = true; auth.user = { id: "owner-one" }; });

type MissionProps = { cards: readonly NearMeCard[]; enabled: boolean };
type MissionModule = { default: ComponentType<MissionProps> };
const cards = [{ id: "pub-one", name: "The First Pub", borough: "Camden", cheapestPrice: 5 }] as const satisfies readonly NearMeCard[];
const laterCards = [{ id: "pub-two", name: "The Second Pub", borough: "Westminster", cheapestPrice: 6 }] as const satisfies readonly NearMeCard[];
let root: Root | undefined;
let host: HTMLDivElement | undefined;

class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>Whole page failed</p> : this.props.children; }
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.restoreAllMocks();
});

it("contains a rejected chunk and requests fresh code on retry while keeping the Pint answer", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  function Mission(props: MissionProps) { return <p>Price check for {props.cards[0]?.name}</p>; }
  const load = vi.fn<() => Promise<MissionModule>>()
    .mockRejectedValueOnce(new Error("ChunkLoadError"))
    .mockResolvedValue({ default: Mission });
  const Panel = createNearPriceEvidencePanel(load);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<PageBoundary><h1>Primary Pint answer</h1><Panel cards={cards} enabled /></PageBoundary>));
  await settle();

  expect(host.querySelector("h1")?.textContent).toBe("Primary Pint answer");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Price check could not load.");
  const retry = host.querySelector<HTMLButtonElement>("button")!;
  expect(retry.textContent).toBe("Try again");
  expect(retry.type).toBe("button");
  await act(async () => root!.render(<PageBoundary><h1>Primary Pint answer</h1><Panel cards={laterCards} enabled /></PageBoundary>));
  retry.focus();
  expect(document.activeElement).toBe(retry);
  act(() => retry.click());
  await settle();

  expect(load).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("Price check for The Second Pub");
  expect(host.textContent).not.toContain("Price check for The First Pub");
  expect(host.querySelector("h1")?.textContent).toBe("Primary Pint answer");
});

it("uses the latest venue props and current owner when a held import arrives", async () => {
  const Owner = createContext("owner-one");
  function Mission(props: MissionProps) {
    const owner = useContext(Owner);
    return <p>{owner}: {props.cards[0]?.id}</p>;
  }
  let resolve!: (module: MissionModule) => void;
  const Panel = createNearPriceEvidencePanel(() => new Promise<MissionModule>((done) => { resolve = done; }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<Owner value="owner-one"><Panel cards={cards} enabled /></Owner>));
  await act(async () => root!.render(<Owner value="owner-two"><Panel cards={laterCards} enabled /></Owner>));
  await act(async () => resolve({ default: Mission }));
  await settle();

  expect(host.textContent).toContain("owner-two: pub-two");
  expect(host.textContent).not.toContain("owner-one");
  expect(host.textContent).not.toContain("pub-one");
  expect(host.querySelector('[role="status"]')).toBeNull();
});

it("preserves a loaded receipt draft and focus through an ordinary prop update", async () => {
  const submitted = vi.fn();
  function Mission(props: MissionProps) {
    const [note, setNote] = useState("");
    return <form onSubmit={(event) => { event.preventDefault(); submitted(props.cards[0]?.id, note); }}>
      <input aria-label="Receipt note" value={note} onChange={(event) => setNote(event.target.value)} />
      <button type="button" onClick={() => setNote("Held receipt draft")}>Add receipt draft</button>
      <button type="submit">Submit receipt</button>
    </form>;
  }
  const Panel = createNearPriceEvidencePanel(() => Promise.resolve({ default: Mission }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<Panel cards={cards} enabled />));
  await settle();
  act(() => host!.querySelector<HTMLButtonElement>('button[type="button"]')!.click());
  const input = host.querySelector<HTMLInputElement>("input")!;
  input.focus();
  await act(async () => root!.render(<Panel cards={[{ ...cards[0], cheapestPrice: 5.5 }]} enabled />));

  expect(host.querySelector("input")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("Held receipt draft");
  act(() => host!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(submitted).toHaveBeenCalledWith("pub-one", "Held receipt draft");
});

it("requests fresh code when an eligible panel reopens after failure", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  function Mission(props: MissionProps) { return <p>Price check for {props.cards[0]?.name}</p>; }
  const load = vi.fn<() => Promise<MissionModule>>()
    .mockRejectedValueOnce(new Error("ChunkLoadError"))
    .mockResolvedValue({ default: Mission });
  const Panel = createNearPriceEvidencePanel(load);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<Panel cards={cards} enabled />));
  await settle();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  act(() => root!.render(<p>No eligible card</p>));
  await act(async () => root!.render(<Panel cards={laterCards} enabled />));
  await settle();

  expect(host.textContent).toContain("Price check for The Second Pub");
  expect(host.textContent).not.toContain("The First Pub");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(load).toHaveBeenCalledTimes(2);
});

it("keeps the Pint answer visible and announces a held price-check import", async () => {
  const Panel = createNearPriceEvidencePanel(() => new Promise<MissionModule>(() => {}));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<><h1>Primary Pint answer</h1><Panel cards={cards} enabled /></>));

  expect(host.querySelector("h1")?.textContent).toBe("Primary Pint answer");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Loading price check.");
});

it("does not request optional code or show its status before verified sign-in", async () => {
  const load = vi.fn(() => new Promise<MissionModule>(() => {}));
  const Panel = createNearPriceEvidencePanel(load);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  auth.identityResolved = false;
  await act(async () => root!.render(<><h1>Primary Pint answer</h1><Panel cards={cards} enabled /></>));
  expect(load).not.toHaveBeenCalled();
  expect(host.querySelector('[role="status"]')).toBeNull();
  auth.identityResolved = true; auth.user = null;
  await act(async () => root!.render(<><h1>Primary Pint answer</h1><Panel cards={cards} enabled /></>));
  expect(load).not.toHaveBeenCalled();
  expect(host.querySelector("h1")?.textContent).toBe("Primary Pint answer");
});

it("hides a held mission immediately on sign-out and resets a loaded receipt for another owner", async () => {
  function Mission() { const [draft, setDraft] = useState(""); return <button onClick={() => setDraft("Private draft")}>{draft || "New receipt"}</button>; }
  let resolve!: (module: MissionModule) => void;
  const Panel = createNearPriceEvidencePanel(() => new Promise<MissionModule>((done) => { resolve = done; }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<Panel cards={cards} enabled />));
  auth.user = null;
  await act(async () => root!.render(<Panel cards={cards} enabled />));
  expect(host.textContent).toBe("");
  await act(async () => resolve({ default: Mission }));
  expect(host.textContent).toBe("");
  auth.user = { id: "owner-one" };
  await act(async () => root!.render(<Panel cards={cards} enabled />));
  act(() => host!.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector("button")?.textContent).toBe("Private draft");
  auth.user = { id: "owner-two" };
  await act(async () => root!.render(<Panel cards={laterCards} enabled />));
  expect(host.querySelector("button")?.textContent).toBe("New receipt");
  expect(host.textContent).not.toContain("Private draft");
});


it("keeps focus in the price check through a focused retry and restores a useful control", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let resolve!: (module: MissionModule) => void;
  const load = vi.fn<() => Promise<MissionModule>>()
    .mockRejectedValueOnce(new Error("ChunkLoadError"))
    .mockImplementation(() => new Promise<MissionModule>((done) => { resolve = done; }));
  const Panel = createNearPriceEvidencePanel(load);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<Panel cards={cards} enabled />));
  await settle();
  const retry = host.querySelector<HTMLButtonElement>("button")!;
  retry.focus();
  expect(document.activeElement).toBe(retry);
  act(() => retry.click());
  await settle();
  expect(document.activeElement).not.toBe(document.body);
  expect(host.contains(document.activeElement)).toBe(true);
  expect(document.activeElement?.textContent).toBe("Price check");
  function Mission() { return <button type="button">Log a price</button>; }
  await act(async () => resolve({ default: Mission }));
  await settle();
  expect(document.activeElement).toBe(host.querySelector("button"));
  expect(document.activeElement?.textContent).toBe("Log a price");
});


it.each([
  ["ready", "outside control"], ["failed", "outside control"],
  ["ready", "blur"], ["failed", "blur"],
] as const)("does not pull focus back after the reader leaves a retry (%s, %s)", async (outcome, departure) => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let resolve!: (module: MissionModule) => void;
  let reject!: (reason: Error) => void;
  const load = vi.fn<() => Promise<MissionModule>>()
    .mockRejectedValueOnce(new Error("ChunkLoadError"))
    .mockImplementation(() => new Promise<MissionModule>((done, fail) => { resolve = done; reject = fail; }));
  const Panel = createNearPriceEvidencePanel(load);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<><button type="button" id="outside">Change area</button><Panel cards={cards} enabled /></>));
  await settle();
  const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
  retry.focus();
  act(() => retry.click());
  await settle();
  const outside = host.querySelector<HTMLButtonElement>("#outside")!;
  if (departure === "outside control") outside.focus();
  else (document.activeElement as HTMLElement).blur();
  const retainedFocus = departure === "outside control" ? outside : document.body;
  expect(document.activeElement).toBe(retainedFocus);
  function Mission() { return <button type="button">Log a price</button>; }
  await act(async () => {
    if (outcome === "ready") resolve({ default: Mission });
    else reject(new Error("ChunkLoadError"));
  });
  await settle();
  expect(document.activeElement).toBe(retainedFocus);
  expect(host.querySelector('[role="status"]')).toBeNull();
  if (outcome === "ready") expect(host.textContent).toContain("Log a price");
  else expect(host.querySelector('[role="alert"]')?.textContent).toContain("Try again");
});


it("discards retry focus when verified identity disappears", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let resolve!: (module: MissionModule) => void;
  const load = vi.fn<() => Promise<MissionModule>>()
    .mockRejectedValueOnce(new Error("ChunkLoadError"))
    .mockImplementation(() => new Promise<MissionModule>((done) => { resolve = done; }));
  const Panel = createNearPriceEvidencePanel(load);
  const view = () => <><button type="button" id="outside">Change area</button><Panel cards={cards} enabled /></>;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(view()));
  await settle();
  const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
  retry.focus();
  act(() => retry.click());
  await settle();
  auth.user = null;
  await act(async () => root!.render(view()));
  const outside = host.querySelector<HTMLButtonElement>("#outside")!;
  outside.focus();
  auth.user = { id: "owner-one" };
  await act(async () => root!.render(view()));
  expect(document.activeElement).toBe(outside);
  function Mission() { return <button type="button">Log a price</button>; }
  await act(async () => resolve({ default: Mission }));
  await settle();
  expect(document.activeElement).toBe(outside);
});

async function retryWithPendingMissionRead() {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  sessionStorage.clear();
  localStorage.clear();
  const missionModule = await import("@/components/nearme/NearPriceEvidenceMission");
  let resolveRead!: (response: Response) => void;
  let rejectRead!: (error: Error) => void;
  const request = vi.spyOn(missionRequests, "authedActionFetch")
    .mockImplementation(() => new Promise<Response>((resolve, reject) => { resolveRead = resolve; rejectRead = reject; }));
  let resolveImport!: (module: MissionModule) => void;
  const load = vi.fn<() => Promise<MissionModule>>()
    .mockRejectedValueOnce(new Error("ChunkLoadError"))
    .mockImplementation(() => new Promise<MissionModule>((resolve) => { resolveImport = resolve; }));
  const Panel = createNearPriceEvidencePanel(load);
  let failRender = false;
  function Mission(props: MissionProps) {
    if (failRender) throw new Error("Mission render failed");
    return <missionModule.default {...props} />;
  }
  const view = (currentCards: readonly NearMeCard[] = cards, enabled = true) => <>
    <h1>Primary Pint answer</h1>
    <button type="button" id="outside">Change area</button>
    <Panel cards={currentCards} enabled={enabled} />
  </>;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(view()));
  await settle();
  const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
  retry.focus();
  act(() => retry.click());
  await settle();
  expect(load).toHaveBeenCalledTimes(2);
  expect(document.activeElement?.textContent).toBe("Price check");
  await act(async () => resolveImport({ default: Mission }));
  await settle();
  expect(request).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector(".pemSlot")).toBeNull();
  expect(document.activeElement?.textContent).toBe("Price check");
  return {
    view,
    request,
    succeed: () => resolveRead(Response.json({ status: "ready", mission: { venueId: "pub-one", reason: "missing" } })),
    fail: () => rejectRead(new Error("Mission read failed")),
    failRender: () => { failRender = true; },
  };
}

it("retains the named retry position when real mission controls arrive after their data read", async () => {
  const pending = await retryWithPendingMissionRead();
  const anchor = document.activeElement;
  await act(async () => pending.succeed());
  await settle();
  const log = host!.querySelector<HTMLButtonElement>(".pemOpen")!;
  expect(log?.textContent).toBe("Log it");
  expect(document.activeElement).toBe(anchor);
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement?.textContent).toBe("Price check");
  const skip = host!.querySelector<HTMLButtonElement>(".pemSkip")!;
  skip.focus();
  await act(async () => root!.render(pending.view([{ ...cards[0], cheapestPrice: 5.5 }])));
  expect(host!.querySelector(".pemSkip")).toBe(skip);
  expect(document.activeElement).toBe(skip);
  pending.failRender();
  await act(async () => root!.render(pending.view()));
  await settle();
  expect(document.activeElement).toBe(host!.querySelector('[role="alert"] button'));
  expect(document.activeElement?.textContent).toBe("Try again");
  expect(host!.querySelector("h1")?.textContent).toBe("Primary Pint answer");
});

it("retains the named retry position when the mission data read fails", async () => {
  const pending = await retryWithPendingMissionRead();
  const anchor = document.activeElement;
  await act(async () => pending.fail());
  await settle();
  expect(host!.querySelector(".pemSlot")).toBeNull();
  expect(document.activeElement).toBe(anchor);
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement?.textContent).toBe("Price check");
});

it.each([
  ["success", "outside control"], ["failure", "outside control"],
  ["success", "blur"], ["failure", "blur"],
] as const)("preserves focus after departure during the mission data read (%s, %s)", async (outcome, departure) => {
  const pending = await retryWithPendingMissionRead();
  const outside = host!.querySelector<HTMLButtonElement>("#outside")!;
  if (departure === "outside control") outside.focus();
  else (document.activeElement as HTMLElement).blur();
  const retainedFocus = departure === "outside control" ? outside : document.body;
  expect(document.activeElement).toBe(retainedFocus);
  await act(async () => {
    if (outcome === "success") pending.succeed();
    else pending.fail();
  });
  await settle();
  expect(document.activeElement).toBe(retainedFocus);
  if (outcome === "success") expect(host!.querySelector(".pemOpen")?.textContent).toBe("Log it");
  else expect(host!.querySelector(".pemSlot")).toBeNull();
  pending.failRender();
  await act(async () => root!.render(pending.view()));
  await settle();
  expect(host!.querySelector('[role="alert"]')?.textContent).toContain("Try again");
  expect(document.activeElement).toBe(retainedFocus);
});

it("retains the named retry position if the reader returns before the data read settles", async () => {
  const pending = await retryWithPendingMissionRead();
  const anchor = document.activeElement as HTMLElement;
  host!.querySelector<HTMLButtonElement>("#outside")!.focus();
  anchor.focus();
  await act(async () => pending.succeed());
  await settle();
  expect(host!.querySelector(".pemOpen")?.textContent).toBe("Log it");
  expect(document.activeElement).toBe(anchor);
});

it.each(["signed-out", "unverified", "different-owner", "disabled"] as const)("discards the data-pending focus position on %s", async (transition) => {
  const pending = await retryWithPendingMissionRead();
  const anchor = document.activeElement;
  if (transition === "signed-out") auth.user = null;
  if (transition === "unverified") auth.identityResolved = false;
  if (transition === "different-owner") auth.user = { id: "owner-two" };
  await act(async () => root!.render(pending.view(cards, transition !== "disabled")));
  expect(anchor?.isConnected).toBe(false);
  const outside = host!.querySelector<HTMLButtonElement>("#outside")!;
  outside.focus();
  await act(async () => pending.succeed());
  await settle();
  expect(document.activeElement).toBe(outside);
  pending.request.mockResolvedValue(Response.json({ status: "ready", mission: { venueId: "pub-one", reason: "missing" } }));
  auth.user = { id: "owner-one" }; auth.identityResolved = true;
  await act(async () => root!.render(pending.view()));
  await settle();
  expect(host!.querySelector(".pemOpen")?.textContent).toBe("Log it");
  expect(document.activeElement).toBe(outside);
});

it("draws no row above the Pint cards while the first price-check import is held", async () => {
  // Most readers have no price check, and the mission then renders nothing. A
  // visible wait row would push the cards down and pull them back up.
  const Panel = createNearPriceEvidencePanel(() => new Promise<MissionModule>(() => {}));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<Panel cards={cards} enabled />));
  const status = host.querySelector('[role="status"]')!;
  expect(status.textContent).toBe("Loading price check.");
  expect(status.classList.contains("sr-only")).toBe(true);
  expect(status.classList.contains("nmnStatus")).toBe(false);
});

it("shows a visible wait after a retry, in the space the failure row held", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const load = vi.fn<() => Promise<MissionModule>>()
    .mockRejectedValueOnce(new Error("ChunkLoadError"))
    .mockImplementation(() => new Promise<MissionModule>(() => {}));
  const Panel = createNearPriceEvidencePanel(load);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<Panel cards={cards} enabled />));
  await settle();
  act(() => host!.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
  await settle();
  expect(host.querySelector('[role="status"]')?.classList.contains("nmnStatus")).toBe(true);
});
