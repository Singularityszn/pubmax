// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "owner-a" } }));
const requests = vi.hoisted(() => ({ authedActionFetch: vi.fn() }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: auth.user, loading: false, configured: true }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/pal/PalPortrait", () => ({ default: () => null }));
vi.mock("@/components/pubpal/PubPalVoice", () => ({ default: () => null }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: requests.authedActionFetch }));

import PalExperience from "@/components/pal/PalExperience";
import { DEFAULT_PAL_DRAFT, type PubPal, type PubPalMemory } from "@/lib/pubPal";

let container: HTMLDivElement;
let root: Root;
let serverMemories: Record<string, PubPalMemory[]>;
let saveMemory: (ownerId: string, init: RequestInit) => Promise<Response>;
let readMemories: (ownerId: string) => Promise<Response>;

function palFor(ownerId: string): PubPal {
  return {
    id: `pal-${ownerId}`,
    ownerId,
    name: ownerId === "owner-a" ? "Moss" : "Robin",
    adultAttestedAt: "2026-09-30T12:00:00.000Z",
    appearance: DEFAULT_PAL_DRAFT.appearance,
    personality: DEFAULT_PAL_DRAFT.personality,
    voice: DEFAULT_PAL_DRAFT.voice,
    muted: true,
    hidden: false,
    proposalPreferences: { memories: false, routes: true },
    masteryPoints: 0,
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:00:00.000Z",
  };
}

function memoryFor(ownerId: string, value: string): PubPalMemory {
  return {
    id: `memory-${ownerId}`,
    palId: `pal-${ownerId}`,
    kind: "drink_preference",
    value,
    provenance: "user_confirmed",
    createdAt: "2026-10-01T02:00:00.000Z",
    updatedAt: "2026-10-01T02:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function renderPal(): Promise<void> {
  await act(async () => {
    root.render(createElement(PalExperience));
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
}

function memorySection(): HTMLElement {
  const section = container.querySelector<HTMLElement>('section[aria-labelledby="pal-memory-title"]');
  expect(section).not.toBeNull();
  return section!;
}

function labelledControl<T extends HTMLSelectElement | HTMLTextAreaElement>(name: string): T {
  const label = [...memorySection().querySelectorAll("label")].find((candidate) => (
    candidate.querySelector("span")?.textContent === name
    || candidate.textContent === name
  ));
  expect(label, `Visible field named ${name}`).toBeDefined();
  const control = label?.control as T | null | undefined;
  expect(control, `Associated control named ${name}`).not.toBeNull();
  expect(control).toBeDefined();
  return control!;
}

function confirmButton(): HTMLButtonElement {
  const button = [...memorySection().querySelectorAll("button")].find((candidate) => candidate.textContent === "Confirm memory");
  expect(button, "Visible explicit memory confirmation").toBeDefined();
  return button!;
}

async function setFact(value: string): Promise<void> {
  const input = labelledControl<HTMLTextAreaElement>("Fact to remember");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function chooseKind(kind: string): Promise<void> {
  const select = labelledControl<HTMLSelectElement>("Memory type");
  await act(async () => {
    select.value = kind;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function posts(): Array<[string, RequestInit, { requiresIdentity: boolean }]> {
  return requests.authedActionFetch.mock.calls.filter(([url, init]) => (
    url === "/api/pub-pal/memories" && init?.method === "POST"
  )) as Array<[string, RequestInit, { requiresIdentity: boolean }]>;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  auth.user = { id: "owner-a" };
  serverMemories = { "owner-a": [], "owner-b": [] };
  saveMemory = async () => Response.json({ error: "Unavailable" }, { status: 503 });
  readMemories = async (ownerId) => Response.json({ memories: serverMemories[ownerId] });
  requests.authedActionFetch.mockReset();
  requests.authedActionFetch.mockImplementation((url: string, init: RequestInit = {}) => {
    const ownerId = auth.user.id;
    if (url === "/api/pub-pal") return Promise.resolve(Response.json({ pal: palFor(ownerId) }));
    if (url === "/api/pub-pal/memories" && init.method === "POST") return saveMemory(ownerId, init);
    if (url === "/api/pub-pal/memories") return readMemories(ownerId);
    throw new Error(`Unexpected request: ${url}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Pub Pal explicit memory confirmation", () => {
  it("offers only existing memory types and never saves while the person edits", async () => {
    await renderPal();
    const types = labelledControl<HTMLSelectElement>("Memory type");
    expect([...types.options].map((option) => option.value).filter(Boolean).sort()).toEqual([
      "accessibility_preference", "atmosphere_preference", "correction", "drink_preference",
      "night_outcome", "transport_preference", "venue_preference",
    ]);
    expect(confirmButton().disabled).toBe(true);
    await chooseKind("drink_preference");
    await setFact("Prefers alcohol-free beer");
    expect(confirmButton().disabled).toBe(false);
    expect(posts()).toHaveLength(0);
    expect(memorySection().textContent).not.toContain("Only these confirmed facts can shape suggestions");
    expect(memorySection().textContent).toContain("Chat recall stays in the current conversation.");
  });

  it("requires a nonblank fact inside the 500-character form limit", async () => {
    await renderPal();
    await chooseKind("drink_preference");
    const input = labelledControl<HTMLTextAreaElement>("Fact to remember");
    expect(input.maxLength).toBe(500);
    await setFact("   ");
    expect(confirmButton().disabled).toBe(true);
    await setFact("a".repeat(500));
    expect(confirmButton().disabled).toBe(false);
    await setFact("a".repeat(501));
    expect(confirmButton().disabled).toBe(true);
    const form = input.closest("form");
    expect(form).not.toBeNull();
    await act(async () => form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(posts()).toHaveLength(0);
  });

  it("saves only after confirmation and lists the fact read back from the server", async () => {
    const saved = memoryFor("owner-a", "Prefers alcohol-free beer");
    saveMemory = async () => {
      serverMemories["owner-a"] = [saved];
      return Response.json({ memory: saved }, { status: 201 });
    };
    await renderPal();
    await chooseKind("drink_preference");
    await setFact("  Prefers   alcohol-free beer  ");
    expect(posts()).toHaveLength(0);
    await act(async () => confirmButton().click());
    expect(posts()).toHaveLength(1);
    const [, init, options] = posts()[0];
    expect(JSON.parse(String(init.body))).toEqual({ kind: "drink_preference", value: "Prefers   alcohol-free beer" });
    expect(options.requiresIdentity).toBe(true);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const row = memorySection().querySelector("li");
    expect(row?.textContent).toContain(saved.value);
    expect(row?.textContent).toContain("You approved this");
    expect(row?.textContent).toContain("Correct");
    expect(row?.textContent).toContain("Delete");
    expect(labelledControl<HTMLTextAreaElement>("Fact to remember").value).toBe("");
    expect(memorySection().textContent).not.toContain("No approved memories yet.");
  });

  it("keeps the draft and its type after a failed save so the person can retry", async () => {
    const saved = { ...memoryFor("owner-a", "Avoids loud music"), kind: "atmosphere_preference" as const };
    let attempts = 0;
    saveMemory = async () => {
      attempts += 1;
      if (attempts === 1) return Response.json({ error: "Unavailable" }, { status: 503 });
      serverMemories["owner-a"] = [saved];
      return Response.json({ memory: saved }, { status: 201 });
    };
    await renderPal();
    await chooseKind("atmosphere_preference");
    await setFact(saved.value);
    await act(async () => confirmButton().click());
    expect(memorySection().querySelector('[role="alert"]')?.textContent).toContain("Could not save this memory.");
    expect(labelledControl<HTMLTextAreaElement>("Fact to remember").value).toBe(saved.value);
    expect(labelledControl<HTMLSelectElement>("Memory type").value).toBe("atmosphere_preference");
    expect(confirmButton().disabled).toBe(false);
    expect(memorySection().querySelector("li")).toBeNull();
    await act(async () => confirmButton().click());
    expect(posts()).toHaveLength(2);
    expect(memorySection().querySelector("li")?.textContent).toContain(saved.value);
    expect(memorySection().querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps the draft when a successful response contains no saved memory", async () => {
    saveMemory = async () => Response.json({}, { status: 201 });
    await renderPal();
    await chooseKind("drink_preference");
    await setFact("Prefers alcohol-free beer");
    await act(async () => confirmButton().click());
    expect(memorySection().querySelector('[role="alert"]')?.textContent).toContain("Could not save this memory.");
    expect(labelledControl<HTMLTextAreaElement>("Fact to remember").value).toBe("Prefers alcohol-free beer");
    expect(memorySection().querySelector("li")).toBeNull();
  });

  it("keeps Saved after a failed refresh and retries only the memory read", async () => {
    const saved = memoryFor("owner-a", "Prefers alcohol-free beer");
    let reads = 0;
    readMemories = async (ownerId) => {
      reads += 1;
      return reads === 2
        ? Response.json({ error: "Unavailable" }, { status: 503 })
        : Response.json({ memories: serverMemories[ownerId] });
    };
    saveMemory = async () => {
      serverMemories["owner-a"] = [saved];
      return Response.json({ memory: saved }, { status: 201 });
    };
    await renderPal();
    await chooseKind("drink_preference");
    await setFact(saved.value);
    await act(async () => confirmButton().click());
    expect(memorySection().textContent).toContain("Saved.");
    expect(memorySection().querySelector('[role="alert"]')?.textContent).toBe("Could not load your memories.");
    expect(labelledControl<HTMLTextAreaElement>("Fact to remember").value).toBe("");
    expect(posts()).toHaveLength(1);
    const retry = [...memorySection().querySelectorAll("button")].find((button) => button.textContent === "Try again");
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(posts()).toHaveLength(1);
    expect(reads).toBe(3);
    expect(memorySection().querySelector("li")?.textContent).toContain(saved.value);
    expect(memorySection().textContent).toContain("Saved.");
    expect(memorySection().querySelector('[role="alert"]')).toBeNull();
  });

  it("locks confirmation while a save is pending", async () => {
    const pending = deferred<Response>();
    saveMemory = () => pending.promise;
    await renderPal();
    await chooseKind("drink_preference");
    await setFact("Prefers alcohol-free beer");
    const submit = confirmButton();
    await act(async () => { submit.click(); submit.click(); });
    expect(posts()).toHaveLength(1);
    expect(submit.disabled).toBe(true);
    expect(labelledControl<HTMLTextAreaElement>("Fact to remember").disabled).toBe(true);
    expect(labelledControl<HTMLSelectElement>("Memory type").disabled).toBe(true);
    await act(async () => pending.resolve(Response.json({ error: "Unavailable" }, { status: 503 })));
  });

  it.each(["success", "failure"])("cancels an old account's pending save and ignores its late %s", async (outcome) => {
    const pending = deferred<Response>();
    saveMemory = () => pending.promise;
    serverMemories["owner-b"] = [memoryFor("owner-b", "Prefers quiet pubs")];
    await renderPal();
    await chooseKind("drink_preference");
    await setFact("Owner A private preference");
    await act(async () => confirmButton().click());
    const oldSignal = posts()[0][1].signal;
    auth.user = { id: "owner-b" };
    await renderPal();
    expect(oldSignal?.aborted).toBe(true);
    expect(container.querySelector("#pal-home-title")?.textContent).toBe("Robin");
    expect(labelledControl<HTMLTextAreaElement>("Fact to remember").value).toBe("");
    expect(memorySection().textContent).toContain("Prefers quiet pubs");
    await act(async () => pending.resolve(outcome === "success"
      ? Response.json({ memory: memoryFor("owner-a", "Owner A private preference") }, { status: 201 })
      : Response.json({ error: "Old account failure" }, { status: 503 })));
    expect(posts()).toHaveLength(1);
    expect(memorySection().textContent).toContain("Prefers quiet pubs");
    expect(memorySection().textContent).not.toContain("Owner A private preference");
    expect(memorySection().textContent).not.toContain("Old account failure");
    expect(memorySection().querySelector('[role="alert"]')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });
});
