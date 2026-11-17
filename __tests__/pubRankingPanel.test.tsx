// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ get: vi.fn(), pending: undefined as Promise<void> | undefined }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: net.get }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/social/ComparePubFlow", () => ({
  default: ({ entries, onClose }: { entries: Array<{ venueName: string }>; onClose: (pending?: Promise<void>) => void }) => (
    <div role="dialog">
      {entries.map((entry) => entry.venueName).join(", ")}
      <button onClick={() => onClose(net.pending)}>Close while saving</button>
    </div>
  ),
}));

import PubRankingPanel from "@/components/social/PubRankingPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let saved = [entry("crown")];
let status = 200;
let malformedError = false;

function entry(id: string) {
  return { venueId: id, venueName: `The ${id}`, band: "loved", place: 1, score: 10 };
}

function button(name: string) {
  return [...host.querySelectorAll("button")].find((node) => node.textContent === name)!;
}

async function mount() {
  await act(async () => root.render(<PubRankingPanel />));
}

async function closePending() {
  let finish!: () => void;
  net.pending = new Promise<void>((resolve) => { finish = resolve; });
  await act(async () => button("Rank a pub").click());
  await act(async () => button("Close while saving").click());
  return finish;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  status = 200;
  malformedError = false;
  saved = [entry("crown")];
  net.pending = undefined;
  net.get.mockImplementation(async (url: string) => new Response(malformedError && url === "/api/social/rankings" ? "Unavailable" : JSON.stringify(
    url === "/api/social/rankings"
      ? status === 200 ? { entries: saved } : { code: status === 403 ? "SOCIAL_ADULT_VERIFICATION_REQUIRED" : "SOCIAL_ACCESS_UNAVAILABLE", retryable: status === 503 }
      : { entries: [] },
  ), { status: url === "/api/social/rankings" ? status : 200 }));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  net.get.mockReset();
});

it("waits for a closed write and refreshes before another comparison", async () => {
  await mount();
  const finish = await closePending();
  await act(async () => button("Rank a pub").click());
  expect(host.querySelector("[role=dialog]")).toBeNull();
  saved = [entry("lamb")];
  await act(async () => finish());
  expect(host.textContent).toContain("The lamb");
  await act(async () => button("Rank a pub").click());
  expect(host.querySelector("[role=dialog]")?.textContent).toContain("The lamb");
});

it("keeps the confirmed list during an outage and requires a successful retry", async () => {
  await mount();
  const finish = await closePending();
  status = 503;
  await act(async () => finish());
  expect(host.textContent).toContain("The crown");
  await act(async () => button("Rank a pub").click());
  expect(host.querySelector("[role=dialog]")).toBeNull();
  status = 200;
  saved = [entry("lamb")];
  await act(async () => button("Try again").click());
  expect(host.textContent).toContain("The lamb");
});

it.each([false, true])("hides the old snapshot after refusal, including an unreadable error: %s", async (malformed) => {
  await mount();
  const finish = await closePending();
  status = 403;
  malformedError = malformed;
  await act(async () => finish());
  expect(host.textContent).not.toContain("The crown");
  expect(button("Rank a pub")).toBeUndefined();
});

it("removes private rows when a delayed refusal follows an earlier outage", async () => {
  await mount();
  const finish = await closePending();
  let refuse!: (response: Response) => void;
  net.get.mockImplementation((url: string) => url === "/api/social/rankings"
    ? new Promise<Response>((resolve) => { refuse = resolve; })
    : Promise.reject(new TypeError("Network failed")));
  await act(async () => finish());
  expect(host.textContent).toContain("The crown");
  await act(async () => refuse(new Response("null", { status: 403 })));
  expect(host.textContent).not.toContain("The crown");
});

it("removes private rows immediately when refusal precedes a stalled companion read", async () => {
  await mount();
  const finish = await closePending();
  net.get.mockImplementation((url: string) => url === "/api/social/rankings"
    ? Promise.resolve(new Response("null", { status: 403 }))
    : new Promise<Response>(() => {}));
  await act(async () => finish());
  expect(host.textContent).not.toContain("The crown");
});
