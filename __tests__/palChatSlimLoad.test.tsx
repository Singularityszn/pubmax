// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const push = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, session: null, getCurrentUserId: () => null }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/pal/PubPalMascot", () => ({ PubPalMascot: () => null }));
vi.mock("@/components/pal/PalChatCompanion", () => ({ default: () => null }));
vi.mock("@/components/pal/PalRecommendationMap", () => ({ default: () => null }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({ useWhatsOnTonight: () => ({ rows: [] }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/offlineCache", () => ({ offlineCache: { get: async () => null, set: async () => true } }));
vi.mock("@/lib/authedFetch", async (original) => ({
  ...(await original<typeof import("@/lib/authedFetch")>()), authedActionFetch: request,
}));

let host: HTMLDivElement;
let root: Root;
let slimRequests: string[];

beforeEach(() => {
  vi.clearAllMocks();
  clearSurfaceCache();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  slimRequests = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = String(input);
    if (!path.startsWith("/data/venues_slim.json")) throw new Error(`Unexpected request: ${path}`);
    slimRequests.push(path);
    return new Response(null, { status: 503 });
  });
  request.mockImplementation(async (_url, init) => Response.json(init?.method === "POST"
    ? { answer: "Try The Harp.", cards: [{ venueId: "venue-1bz7oic", title: "The Harp", place: "Westminster", price: null }], proposals: [] }
    : { thread: null }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

async function mountChat() {
  const { default: PalChat } = await import("@/components/pal/PalChat");
  await act(async () => root.render(createElement(PalChat)));
}

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function send(text: string) {
  const input = host.querySelector("input");
  expect(input?.disabled).toBe(false);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("form")!.requestSubmit();
    await vi.dynamicImportSettled();
  });
}

it.each(["Where is it?", "Take me there"])("opens the already known pub without another slim fetch: %s", async (query) => {
  await mountChat();
  expect(slimRequests).toEqual(["/data/venues_slim.json"]);
  await send("Find pubs in Camden");
  expect(host.textContent).toContain("Try The Harp.");
  const before = [...slimRequests];

  await send(query);

  expect(host.textContent).toContain("Opening The Harp");
  expect(push.mock.calls.at(-1)?.[0]).toBe("/map?sel=venue-1bz7oic");
  expect(slimRequests).toEqual(before);
});

it("aborts the pending slim request when PalChat unmounts", async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== "/data/venues_slim.json") throw new Error(`Unexpected request: ${String(input)}`);
    const signal = init?.signal;
    if (!signal) throw new Error("The slim request needs an abort signal");
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), { once: true });
    });
  });

  await mountChat();
  expect(signals).toHaveLength(1);
  expect(signals[0]!.aborted).toBe(false);

  await act(async () => root.render(null));

  expect(signals[0]!.aborted).toBe(true);
});
