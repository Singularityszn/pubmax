// @vitest-environment jsdom

// Find-your-lot search knows where each match already stands with the viewer, so
// a mate is never offered a Follow they have already pressed. The server names
// the relation (`/api/profiles/search?viewer=`); this surface only has to say it.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ accountRevision: 0, user: { id: "account-a" } }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  }),
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => "alice",
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => true,
}));

const follow = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: follow.request }));

import FindYourLot from "@/components/social/FindYourLot";

const MATCHES = [
  { id: "1", handle: "sam_mate", displayName: "Sam Mate", relation: "mates" },
  { id: "2", handle: "sam_followed", relation: "following" },
  { id: "3", handle: "sam_fan", relation: "follows_you" },
  { id: "4", handle: "sam_new", relation: "none" },
];

let host: HTMLDivElement;
let root: Root | null;
let search: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rowFor(handle: string): HTMLElement {
  const row = [...host.querySelectorAll("li.findLot__row")].find((item) =>
    (item.textContent ?? "").includes(handle),
  );
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${handle}`);
  return row;
}

function buttonIn(handle: string): HTMLButtonElement {
  const control = rowFor(handle).querySelector("button");
  if (!(control instanceof HTMLButtonElement)) throw new Error(`No button for ${handle}`);
  return control;
}

async function typeQuery(value: string): Promise<void> {
  const input = host.querySelector("input[type=search]");
  if (!(input instanceof HTMLInputElement)) throw new Error("Search field not found");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  search = vi.fn(async () => json({ matches: MATCHES }));
  vi.stubGlobal("fetch", search);
  follow.request.mockReset();
  follow.request.mockResolvedValue(json({ following: true }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(FindYourLot));
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

describe("FindYourLot relation", () => {
  it("names the viewer in the search so the answer can say who they already follow", async () => {
    await typeQuery("sam");
    await vi.waitFor(() => expect(host.querySelectorAll("li.findLot__row")).toHaveLength(4));
    expect(search).toHaveBeenCalledWith(
      "/api/profiles/search?q=sam&viewer=alice",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("says Mates for a mate and Following for somebody already followed, neither pressable", async () => {
    await typeQuery("sam");
    await vi.waitFor(() => expect(host.querySelectorAll("li.findLot__row")).toHaveLength(4));

    expect(buttonIn("sam_mate").textContent).toBe("Mates");
    expect(buttonIn("sam_mate").disabled).toBe(true);
    expect(rowFor("sam_mate").textContent).toContain("You follow each other");
    expect(buttonIn("sam_followed").textContent).toBe("Following");
    expect(buttonIn("sam_followed").disabled).toBe(true);
  });

  it("offers Follow back to a follower and Follow to a stranger", async () => {
    await typeQuery("sam");
    await vi.waitFor(() => expect(host.querySelectorAll("li.findLot__row")).toHaveLength(4));

    expect(buttonIn("sam_fan").textContent).toBe("Follow back");
    expect(buttonIn("sam_fan").disabled).toBe(false);
    expect(rowFor("sam_fan").textContent).toContain("Follows you");
    expect(buttonIn("sam_new").textContent).toBe("Follow");
    expect(rowFor("sam_new").textContent).not.toContain("Follows you");
  });

  it("turns Follow back into Mates once the follow lands", async () => {
    await typeQuery("sam");
    await vi.waitFor(() => expect(host.querySelectorAll("li.findLot__row")).toHaveLength(4));

    await act(async () => {
      buttonIn("sam_fan").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(follow.request).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(buttonIn("sam_fan").textContent).toBe("Mates"));
    expect(buttonIn("sam_fan").disabled).toBe(true);
  });

  it("turns Follow into Following once the follow lands", async () => {
    await typeQuery("sam");
    await vi.waitFor(() => expect(host.querySelectorAll("li.findLot__row")).toHaveLength(4));

    await act(async () => {
      buttonIn("sam_new").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(buttonIn("sam_new").textContent).toBe("Following"));
  });

  it("drops a late answer for the previous query instead of painting its relations", async () => {
    // The first search is still on the wire when the viewer types on.
    let releaseFirst: (response: Response) => void = () => undefined;
    let firstSignal: AbortSignal | undefined;
    search
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        firstSignal = init.signal ?? undefined;
        return new Promise<Response>((resolve) => { releaseFirst = resolve; });
      })
      .mockImplementationOnce(async () =>
        json({ matches: [{ id: "7", handle: "samuel", relation: "none" }] }),
      );

    await typeQuery("sam");
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await typeQuery("samu");
    await vi.waitFor(() => expect(host.querySelectorAll("li.findLot__row")).toHaveLength(1));
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      releaseFirst(json({ matches: MATCHES }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelectorAll("li.findLot__row")).toHaveLength(1);
    expect(buttonIn("samuel").textContent).toBe("Follow");
  });

  it("falls back to Follow when the answer carries no relation", async () => {
    search.mockResolvedValueOnce(json({ matches: [{ id: "9", handle: "sam_old" }] }));
    await typeQuery("sam");
    await vi.waitFor(() => expect(host.querySelectorAll("li.findLot__row")).toHaveLength(1));
    expect(buttonIn("sam_old").textContent).toBe("Follow");
  });
});
