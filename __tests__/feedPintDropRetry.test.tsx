// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FeedItem, PintDropDTO } from "@/lib/feed";
import { defined } from "@/__tests__/helpers/defined";

const card = vi.hoisted(() => ({ retry: null as null | ((id: string) => Promise<void>) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ handle: "alice" }) }));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "test-token" }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightConditionsStrip", () => ({ default: () => null }));
vi.mock("@/components/feed/PresenceStrip", () => ({ default: () => null }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => false }));
vi.mock("@/lib/realtime", () => ({ countSpillingNow: () => 0, subscribeToNewDrops: () => () => {} }));
vi.mock("@/components/map/composer/proposeWithTags", () => ({ proposeWithTagsForDrop: vi.fn() }));
vi.mock("@/components/feed/FeedCard", () => ({
  default: ({ item, onRetryPost }: { item: FeedItem; onRetryPost: (id: string) => Promise<void> }) => {
    card.retry = onRetryPost;
    return createElement("article", null, item.id);
  },
}));

import FeedPageClient from "@/app/feed/FeedPageClient";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { publishAuthActionState } from "@/lib/authedFetch";
import { proposeWithTagsForDrop } from "@/components/map/composer/proposeWithTags";
import {
  buildOptimisticSpillDrop, buildOptimisticSpillRetryPayload,
  failOptimisticSpill, readOptimisticSpills, upsertOptimisticSpill, writeOptimisticSpills,
} from "@/lib/optimisticSpillPost";

type Request = { body: FormData; resolve: (response: Response) => void; reject: (error: Error) => void };
let requests: Request[];
let container: HTMLDivElement;
let root: Root;

function seed(id: string) {
  const input = {
    clientRequestId: id, venueId: "venue-1", venueName: "The Pub", handle: "alice",
    priceGbp: "3.25", drink: "Pale ale", passedDownNote: "", era: "", visibility: "public" as const,
    vibeTags: [], pintPhotoUrl: null, venuePhotoUrl: null, receiptPhotoUrl: null,
    measure: "half" as const, measureLabel: "", createdAt: "2026-11-10T12:00:00.000Z",
    withHandles: ["bob"],
  };
  writeOptimisticSpills(localStorage, failOptimisticSpill(
    upsertOptimisticSpill(readOptimisticSpills(localStorage), buildOptimisticSpillDrop(input), buildOptimisticSpillRetryPayload(input)),
    id, "Offline",
  ));
}

function saved(id: string): PintDropDTO {
  return {
    id, venueId: "venue-1", handle: "alice", priceGbp: 3.25, drink: "Pale ale",
    passedDownNote: "", era: "", provenance: "contributor", createdAt: "2026-11-10T12:00:00.000Z",
    pintPhotoUrl: null, venuePhotoUrl: null,
  };
}

async function start(id = "request-1") {
  let pending!: Promise<void>;
  await act(async () => { pending = card.retry!(id); });
  return { pending };
}

beforeEach(async () => {
  vi.clearAllMocks();
  card.retry = null;
  requests = [];
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  setProviderIdentity("supabase", "account-a");
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  localStorage.setItem("pubmax_handle", "alice");
  seed("request-1");
  seed("request-2");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Promise<Response>((resolve, reject) => requests.push({ body: init.body as FormData, resolve, reject }));
    }
    return Promise.resolve(Response.json({ drops: [], summaries: {} }));
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(FeedPageClient)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

it("retries the submitted measure and reconciles only its own request", async () => {
  const { pending } = await start();
  expect(requests).toHaveLength(1);
  expect(defined(requests[0]).body.get("measure")).toBe("half");
  expect(defined(requests[0]).body.get("priceGbp")).toBe("3.25");
  await act(async () => {
    defined(requests[0]).resolve(Response.json({ drop: saved("saved-1") }));
    await pending;
  });
  expect(readOptimisticSpills(localStorage).map(({ drop }) => drop.id)).toEqual([
    "saved-1", "optimistic-request-2",
  ]);
  expect(proposeWithTagsForDrop).toHaveBeenCalledWith(saved("saved-1"), ["bob"]);
});

it.each(["success", "refusal", "network"] as const)("drops a stale account's %s without local effects", async (outcome) => {
  const { pending } = await start();
  setProviderIdentity("supabase", "account-b");
  localStorage.clear();
  seed("request-1");
  localStorage.setItem("pubmax_handle", "charlie");
  const before = readOptimisticSpills(localStorage);
  await act(async () => {
    if (outcome === "network") defined(requests[0]).reject(new Error("Offline again"));
    else defined(requests[0]).resolve(outcome === "success"
      ? Response.json({ drop: saved("stale-drop") })
      : Response.json({ error: "Refused" }, { status: 422 }));
    await pending;
  });
  expect(readOptimisticSpills(localStorage)).toEqual(before);
  expect(localStorage.getItem("pubmax_handle")).toBe("charlie");
  expect(proposeWithTagsForDrop).not.toHaveBeenCalled();
});

it("does not POST an old payload if the account changes during preparation", async () => {
  await act(async () => {
    const pending = card.retry!("request-1");
    setProviderIdentity("supabase", "account-b");
    localStorage.clear();
    seed("request-1");
    await pending;
  });
  expect(requests).toHaveLength(0);
  expect(defined(readOptimisticSpills(localStorage)[0]).drop.optimistic).toMatchObject({ state: "failed", message: "Offline" });
});

it("rejects duplicate retries and permits independent requests and later retries", async () => {
  const first = await start();
  const duplicate = await start();
  const second = await start("request-2");
  await duplicate.pending;
  expect(requests).toHaveLength(2);
  await act(async () => {
    defined(requests[1]).resolve(Response.json({ drop: saved("saved-2") }));
    defined(requests[0]).reject(new Error("Connection lost"));
    await Promise.all([first.pending, second.pending]);
  });
  expect(readOptimisticSpills(localStorage).find((entry) => entry.clientRequestId === "request-1")?.drop.optimistic)
    .toMatchObject({ state: "failed", canRetry: true, message: "Connection lost" });
  expect(readOptimisticSpills(localStorage).find((entry) => entry.clientRequestId === "request-2")?.drop.id).toBe("saved-2");
  const retry = await start();
  expect(requests).toHaveLength(3);
  await act(async () => {
    defined(requests[2]).resolve(Response.json({ drop: saved("saved-1") }));
    await retry.pending;
  });
  expect(readOptimisticSpills(localStorage).find((entry) => entry.clientRequestId === "request-1")?.drop.id).toBe("saved-1");
});
