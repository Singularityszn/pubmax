// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ get: vi.fn(), pending: undefined as Promise<void> | undefined, confirmed: [] as unknown[] }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: net.get }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/social/ComparePubFlow", () => ({
  default: ({ entries, onClose, onSaved }: {
    entries: Array<{ venueName: string }>;
    onClose: (pending?: Promise<void>, reason?: "refused") => void;
    onSaved: (entries: unknown[]) => void;
  }) => (
    <div role="dialog">
      {entries.map((entry) => entry.venueName).join(", ")}
      <button onClick={() => onClose(net.pending)}>Close while saving</button>
      <button onClick={() => onSaved(net.confirmed)}>Confirm save</button>
      <button onClick={() => onClose(undefined, "refused")}>Refused</button>
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
  net.confirmed = [];
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

it.each([503, 429])("uses valid comparison rankings when optional reviews return %s", async (reviewStatus) => {
  net.get.mockImplementation(async (url: string) => new Response(JSON.stringify(
    url === "/api/social/rankings" ? { entries: saved } : { code: "REVIEWS_UNAVAILABLE", retryable: true },
  ), { status: url === "/api/social/rankings" ? 200 : reviewStatus }));
  await mount();
  expect(host.textContent).toContain("The crown");
  expect(button("Rank a pub")?.getAttribute("aria-disabled")).not.toBe("true");
  await act(async () => button("Rank a pub").click());
  expect(host.querySelector("[role=dialog]")?.textContent).toContain("The crown");
});

it("publishes fresh comparison entries while optional reviews are unavailable", async () => {
  await mount();
  const finish = await closePending();
  net.get.mockImplementation(async (url: string) => new Response(JSON.stringify(
    url === "/api/social/rankings" ? { entries: [entry("lamb")] } : { code: "REVIEWS_UNAVAILABLE", retryable: true },
  ), { status: url === "/api/social/rankings" ? 200 : 503 }));
  await act(async () => finish());
  expect(host.textContent).toContain("The lamb");
  expect(host.textContent).not.toContain("The crown");
  expect(button("Rank a pub")?.getAttribute("aria-disabled")).not.toBe("true");
});

it("shows comparison entries before optional reviews settle, then honours a late refusal", async () => {
  let finishReviews!: (response: Response) => void;
  net.get.mockImplementation((url: string) => url === "/api/social/rankings"
    ? Promise.resolve(new Response(JSON.stringify({ entries: saved })))
    : new Promise<Response>((resolve) => { finishReviews = resolve; }));
  await mount();
  expect(host.textContent).toContain("The crown");
  expect(button("Rank a pub")?.getAttribute("aria-disabled")).not.toBe("true");
  await act(async () => finishReviews(new Response("null", { status: 403 })));
  expect(host.textContent).not.toContain("The crown");
  expect(button("Rank a pub")).toBeUndefined();
});

it("still retires comparison entries when the reviews read refuses access", async () => {
  await mount();
  const finish = await closePending();
  net.get.mockImplementation(async (url: string) => new Response(JSON.stringify(
    url === "/api/social/rankings" ? { entries: saved } : { code: "SOCIAL_ADULT_VERIFICATION_REQUIRED" },
  ), { status: url === "/api/social/rankings" ? 200 : 403 }));
  await act(async () => finish());
  expect(host.textContent).not.toContain("The crown");
  expect(button("Rank a pub")).toBeUndefined();
});

it("makes a confirmed save the checkpoint at once and keeps it through an outage", async () => {
  await mount();
  await act(async () => button("Rank a pub").click());
  const reads = net.get.mock.calls.length;
  status = 503;
  net.confirmed = [entry("lamb"), entry("crown")];
  await act(async () => button("Confirm save").click());
  expect(net.get.mock.calls.length).toBe(reads);
  expect(host.textContent).toContain("The lamb");
  await act(async () => button("Close while saving").click());
  // Closing still checks the list once; the outage keeps the confirmed rows.
  expect(net.get.mock.calls.filter(([url]) => url === "/api/social/rankings").length).toBe(2);
  expect(host.textContent).toContain("The lamb");
  expect(button("Try again")).toBeDefined();
});

it("keeps focus on the section heading when a retry is refused, without rows", async () => {
  status = 503;
  await mount();
  const retry = button("Try again");
  retry.focus();
  status = 403;
  await act(async () => retry.click());
  await act(async () => {});
  expect(host.textContent).not.toContain("The crown");
  expect(button("Rank a pub")).toBeUndefined();
  expect(document.activeElement?.id).toBe("pub-ranking-title");
  expect(host.querySelector("[role=status]")?.textContent).toBe("Your ranking is not available to this account right now.");
});

it("does not reopen a retired comparison after access is restored", async () => {
  await mount();
  await act(async () => button("Rank a pub").click());
  const reads = net.get.mock.calls.length;
  await act(async () => button("Refused").click());
  await act(async () => {});
  expect(host.querySelector("[role=dialog]")).toBeNull();
  expect(net.get.mock.calls.length).toBe(reads);
  expect(host.textContent).not.toContain("The crown");
  expect(document.activeElement?.id).toBe("pub-ranking-title");
  status = 200;
  await act(async () => root.render(<PubRankingPanel refreshKey="access-restored" />));
  expect(host.textContent).toContain("The crown");
  expect(host.querySelector("[role=dialog]")).toBeNull();
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
