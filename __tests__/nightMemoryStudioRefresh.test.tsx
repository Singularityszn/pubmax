// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "memory-owner-token" }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(), trackMeaningfulCoreAction: vi.fn() }));

import NightMemoryStudio from "@/components/profile/NightMemoryStudio";
import { publishAuthActionState } from "@/lib/authedFetch";
import { setProviderIdentity } from "@/lib/authProviderRevision";

const OWNER = "memory-owner";
const first = { id: "first-memory", title: "First night", createdAt: "2026-10-30T20:00:00Z" };
const selected = { id: "selected-memory", title: "Chosen night", createdAt: "2026-10-30T21:00:00Z" };
const brought = { id: "brought-memory", title: "Brought private recap", createdAt: "2026-10-31T22:00:00Z" };
const created = { id: "created-memory", title: "New private night", createdAt: "2026-11-01T00:00:00Z" };
let host: HTMLDivElement;
let root: Root;
let readMemories: (init: RequestInit) => Promise<Response>;
let mutateMemory: (path: string, init: RequestInit) => Promise<Response>;

async function render(memoriesRevision = 0, userId = OWNER) {
  await act(async () => {
    root.render(createElement(NightMemoryStudio, { key: userId, userId, memoriesRevision }));
  });
}

function delayedMemoryBody() {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  let parsed!: () => void;
  const didParse = new Promise<void>((resolve) => { parsed = resolve; });
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }));
  const readJson = response.json.bind(response);
  response.json = async () => {
    const result: unknown = await readJson();
    parsed();
    return result;
  };
  return {
    response,
    async finish(memories: typeof first[]) {
      body.enqueue(new TextEncoder().encode(JSON.stringify({ memories })));
      body.close();
      await didParse;
    },
  };
}

async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  setProviderIdentity("supabase", OWNER);
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  readMemories = async () => Response.json({ memories: [first, selected] });
  mutateMemory = async (path) => { throw new Error(`Unexpected Memory mutation: ${path}`); };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init = {}) => {
    const path = String(input);
    if (init.method === "POST" || init.method === "DELETE") return mutateMemory(path, init);
    if (path === "/api/night-memories") return readMemories(init);
    if (path === "/api/night-stories") return Response.json({ stories: [] });
    if (path.endsWith("/moments")) return Response.json({ moments: [] });
    throw new Error(`Unexpected studio request: ${path}`);
  }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  setProviderIdentity("supabase", null);
  publishAuthActionState({ status: "unknown", identityResolved: false });
  vi.unstubAllGlobals();
});

it("shows newly brought Memories without remounting or losing the reader's draft and selected Memory", async () => {
  await render();
  await vi.waitFor(() => expect(host.textContent).toContain("Chosen night"));
  const title = host.querySelector<HTMLInputElement>('input[placeholder="Friday detour"]')!;
  const caption = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="We followed the music and found a tiny basement set."]')!;
  const selection = host.querySelector<HTMLSelectElement>("select")!;
  await type(title, "My unfinished night");
  await type(caption, "Keep this unsaved Moment");
  await act(async () => {
    selection.value = selected.id;
    selection.dispatchEvent(new Event("change", { bubbles: true }));
  });

  readMemories = async () => Response.json({ memories: [brought, first, selected] });
  await render(1);
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Your private Memories"]')?.textContent).toContain(brought.title));
  expect(host.querySelector(".memoryStudioShelf strong")?.textContent).toBe("3");
  expect(host.querySelector('input[placeholder="Friday detour"]')).toBe(title);
  expect(title.value).toBe("My unfinished night");
  expect(caption.value).toBe("Keep this unsaved Moment");
  expect(selection.value).toBe(selected.id);
});

it("keeps a newly brought Memory when an older refresh finishes parsing after it", async () => {
  readMemories = async () => Response.json({ memories: [] });
  await render();
  await vi.waitFor(() => expect(host.querySelector(".memoryStudioShelf strong")?.textContent).toBe("0"));
  const stale = delayedMemoryBody();
  const staleRequest: { signal?: AbortSignal | null } = {};
  readMemories = async (init) => {
    staleRequest.signal = init.signal;
    return stale.response;
  };
  await render(1);

  readMemories = async () => Response.json({ memories: [brought] });
  await render(2);
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Your private Memories"]')?.textContent).toContain(brought.title));
  expect(staleRequest.signal?.aborted).toBe(true);
  await act(async () => { await stale.finish([]); });
  expect(host.querySelector(".memoryStudioShelf strong")?.textContent).toBe("1");
  expect(host.querySelector('[aria-label="Your private Memories"]')?.textContent).toContain(brought.title);
});

it("does not show an old owner's late Memory response after the owner changes", async () => {
  const stale = delayedMemoryBody();
  const staleRequest: { signal?: AbortSignal | null } = {};
  readMemories = async (init) => {
    staleRequest.signal = init.signal;
    return stale.response;
  };
  await render();
  readMemories = async () => Response.json({ memories: [brought] });
  await act(async () => { setProviderIdentity("supabase", "next-memory-owner"); });
  await render(0, "next-memory-owner");
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Your private Memories"]')?.textContent).toContain(brought.title));
  expect(staleRequest.signal?.aborted).toBe(true);
  await act(async () => { await stale.finish([first]); });
  expect(host.querySelector('[aria-label="Your private Memories"]')?.textContent).not.toContain(first.title);
  expect(host.querySelector(".memoryStudioShelf strong")?.textContent).toBe("1");
});

it("retains a newly created Memory and its selection when an earlier shelf refresh finishes", async () => {
  await render();
  await vi.waitFor(() => expect(host.textContent).toContain(selected.title));
  const stale = delayedMemoryBody();
  readMemories = async () => stale.response;
  await render(1);
  mutateMemory = async (path, init) => {
    expect(path).toBe("/api/night-memories");
    expect(JSON.parse(String(init.body))).toEqual({ title: created.title });
    readMemories = async () => Response.json({ memories: [created, brought, first, selected] });
    return Response.json({ memory: created }, { status: 201 });
  };
  await type(host.querySelector<HTMLInputElement>('input[placeholder="Friday detour"]')!, created.title);
  await act(async () => { host.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click(); });
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Your private Memories"]')?.textContent).toContain(created.title));

  await act(async () => { await stale.finish([brought, first, selected]); });
  expect(host.querySelector('[aria-label="Your private Memories"]')?.textContent).toContain(created.title);
  expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe(created.id);
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Your private Memories"]')?.textContent).toContain(brought.title));
  expect(host.querySelector(".memoryStudioShelf strong")?.textContent).toBe("4");
});

it("does not resurrect a deleted Memory when an earlier shelf refresh finishes", async () => {
  await render();
  await vi.waitFor(() => expect(host.textContent).toContain(selected.title));
  const selection = host.querySelector<HTMLSelectElement>("select")!;
  await act(async () => {
    selection.value = selected.id;
    selection.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const stale = delayedMemoryBody();
  readMemories = async () => stale.response;
  await render(1);
  mutateMemory = async (path, init) => {
    expect(path).toBe(`/api/night-memories/${first.id}`);
    expect(init.method).toBe("DELETE");
    readMemories = async () => Response.json({ memories: [brought, selected] });
    return Response.json({});
  };
  const row = [...host.querySelectorAll('[aria-label="Your private Memories"] > li')]
    .find((item) => item.textContent?.includes(first.title))!;
  await act(async () => { row.querySelector<HTMLButtonElement>(".memoryKeepRemove")!.click(); });
  await act(async () => { row.querySelector<HTMLButtonElement>(".memoryKeepConfirm button")!.click(); });
  await vi.waitFor(() => expect(host.textContent).toContain("Memory removed."));

  await act(async () => { await stale.finish([first, selected]); });
  expect(host.querySelector('[aria-label="Your private Memories"]')?.textContent).not.toContain(first.title);
  expect(selection.value).toBe(selected.id);
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Your private Memories"]')?.textContent).toContain(brought.title));
  expect(host.querySelector(".memoryStudioShelf strong")?.textContent).toBe("2");
});
