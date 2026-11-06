// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_PAL_DRAFT, type PalAnimationState, type PubPal } from "@/lib/pubPal";
import { announceLocalPalChange, LOCAL_PAL_KEY } from "@/lib/localPal";

const fetches = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: fetches.fetch }));
const auth = vi.hoisted(() => ({ userId: "owner-a" as string | null }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => ({ user: auth.userId ? { id: auth.userId } : null, loading: false, getCurrentUserId: () => auth.userId }) }));
vi.mock("@/components/pal/PalPortrait", () => ({ default: ({ name, appearance, state }: { name: string; appearance: PubPal["appearance"]; state: PalAnimationState }) => createElement("span", { "data-species": appearance.species, "data-state": state }, name) }));
import PalChatCompanion from "@/components/pal/PalChatCompanion";

let root: Root;
let container: HTMLDivElement;
function pal(ownerId: string, name: string): PubPal {
  return {
    ...DEFAULT_PAL_DRAFT, ownerId, name, id: ownerId,
    adultAttestedAt: "2026-10-04T12:00:00.000Z", muted: false, hidden: false,
    proposalPreferences: { memories: false, routes: true }, masteryPoints: 0,
    createdAt: "2026-10-04T12:00:00.000Z", updatedAt: "2026-10-04T12:00:00.000Z",
  };
}
function response(ownerId: string, name: string) {
  return new Response(JSON.stringify({ pal: pal(ownerId, name) }));
}
function cache(value: PubPal) {
  localStorage.setItem("pubmax_account_owner", value.ownerId);
  localStorage.setItem(LOCAL_PAL_KEY, JSON.stringify(value));
}
async function render(owner: string | null) {
  auth.userId = owner === "anonymous" ? null : owner;
  await act(async () => { root.render(createElement(PalChatCompanion, { owner, state: "idle" })); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  fetches.fetch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("hides the prior owner's Pal immediately during account changes and sign-out", async () => {
  fetches.fetch.mockResolvedValueOnce(response("owner-a", "Alice Pal")).mockImplementation(() => new Promise(() => {}));
  await render("owner-a");
  expect(container.textContent).toBe("Alice Pal");
  await render("owner-b");
  expect(container.textContent).toBe("Pub Pal");
  await render("anonymous");
  expect(container.textContent).toBe("Pub Pal");
  await render(null);
  expect(container.textContent).toBe("Pub Pal");
});

it("aborts an old owner's read and ignores its late completion", async () => {
  let finishA!: (value: Response) => void;
  fetches.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finishA = resolve; }))
    .mockResolvedValueOnce(response("owner-b", "Bob Pal"));
  await render("owner-a");
  const signal = fetches.fetch.mock.calls[0]?.[1]?.signal as AbortSignal | undefined;
  await render("owner-b");
  expect(signal?.aborted).toBe(true);
  expect(container.textContent).toBe("Bob Pal");
  await act(async () => { finishA(response("owner-a", "Alice Pal")); });
  expect(container.textContent).toBe("Bob Pal");
});

it("uses the server portrait and muted state instead of a stale local Pal", async () => {
  cache(pal("owner-a", "Cached Pal"));
  fetches.fetch.mockResolvedValue(new Response(JSON.stringify({ pal: {
    ...pal("owner-a", "Server Pal"),
    appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "raven" }, muted: true,
  } })));
  await render("owner-a");
  expect(container.textContent).toBe("Server Pal");
  expect(container.querySelector("span")?.dataset.species).toBe("raven");
  expect(container.querySelector("span")?.dataset.state).toBe("sleeping");
});

it.each(["hidden", "deleted"])("respects a server %s Pal despite a visible cached Pal", async (change) => {
  cache(pal("owner-a", "Cached Pal"));
  fetches.fetch.mockResolvedValue(new Response(JSON.stringify({ pal: change === "hidden" ? { ...pal("owner-a", "Hidden Pal"), hidden: true } : null })));
  await render("owner-a");
  expect(container.textContent).toBe("Pub Pal");
});

it.each(["hidden", "removed"])("retires the server portrait when the local Pal is %s and refresh fails", async (change) => {
  const cached = pal("owner-a", "Cached Pal");
  cache(cached);
  let finish!: (value: Response) => void;
  fetches.fetch.mockResolvedValueOnce(response("owner-a", "Server Pal"))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  await render("owner-a");
  expect(container.textContent).toBe("Server Pal");
  await act(async () => {
    if (change === "hidden") cache({ ...cached, hidden: true });
    else localStorage.removeItem(LOCAL_PAL_KEY);
    announceLocalPalChange();
  });
  expect(container.textContent).toBe("Pub Pal");
  await act(async () => finish(new Response(null, { status: 503 })));
  expect(container.textContent).toBe("Pub Pal");
});

it("does not revive a server portrait after signing out and returning while the read fails", async () => {
  fetches.fetch.mockResolvedValueOnce(response("owner-a", "Alice Pal"))
    .mockRejectedValue(new Error("offline"));
  await render("owner-a");
  expect(container.textContent).toBe("Alice Pal");
  await render(null);
  await render("owner-a");
  expect(container.textContent).toBe("Pub Pal");
});

it.each(["hidden", "removed"])("invalidates a visible server result after an already hidden cache becomes %s", async (change) => {
  const hidden = { ...pal("owner-a", "Cached Pal"), hidden: true };
  cache(hidden);
  let finish!: (value: Response) => void;
  fetches.fetch.mockResolvedValueOnce(response("owner-a", "Server Pal"))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  await render("owner-a");
  expect(container.textContent).toBe("Server Pal");
  await act(async () => {
    if (change === "hidden") cache({ ...hidden, updatedAt: "2026-10-04T12:01:00.000Z" });
    else localStorage.removeItem(LOCAL_PAL_KEY);
    announceLocalPalChange();
  });
  expect(container.textContent).toBe("Pub Pal");
  expect(fetches.fetch).toHaveBeenCalledTimes(2);
  await act(async () => finish(new Response(null, { status: 503 })));
  expect(container.textContent).toBe("Pub Pal");
});
