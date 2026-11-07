// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAccessToken = vi.hoisted(() => vi.fn(async () => "account-a-token"));

vi.mock("@/lib/authClient", () => ({ getAccessToken, warmAuthClientModule: () => undefined }));

// The contribution gate reads the account from useAuth. Only the two fields it
// acts on are steered; everything else is the real signed-out context.
const gateAuth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  contributionAuth: null as { userId: string; accessToken: string } | null,
}));
vi.mock("@/components/auth/AuthProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/auth/AuthProvider")>();
  return {
    ...actual,
    useAuth: () => ({
      ...actual.useAuth(),
      user: gateAuth.user,
      contributionAuth: gateAuth.contributionAuth,
    }),
  };
});

import SaveCrawlStory from "@/components/crawl/SaveCrawlStory";
import { publishAuthActionState } from "@/lib/authedFetch";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import {
  CONTRIBUTION_ADULT_REFUSAL,
  CONTRIBUTION_UNDER_18_REFUSAL,
} from "@/lib/contributionGateStatus";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gateAuth.user = null;
  gateAuth.contributionAuth = null;
  setProviderIdentity("supabase", null);
  publishAuthActionState({ status: "unknown", identityResolved: false });
  window.localStorage.removeItem("pubmax_handle");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  setProviderIdentity("supabase", null);
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  vi.restoreAllMocks();
});

describe("SaveCrawlStory anonymous persistence", () => {
  it("completes an unresolved anonymous save after an account arrives without attribution", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ slug: "anonymous-story" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    await act(async () => {
      root.render(createElement(SaveCrawlStory, {
        stops: [{ venueId: "venue-1", name: "The Dove", priceGbp: null }],
      }));
    });

    const openButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Save as story"));
    if (!openButton) throw new Error("Save as story button missing.");
    await act(async () => openButton.click());

    const saveButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Save a permanent link"));
    if (!saveButton) throw new Error("Permanent link button missing.");

    await act(async () => {
      saveButton.click();
      setProviderIdentity("supabase", "account-a");
      publishAuthActionState({ status: "signed-in", identityResolved: true });
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.querySelector('a[href*="/crawls/anonymous-story"]')).not.toBeNull();
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBeNull();
    expect(JSON.parse(String(init.body))).not.toHaveProperty("authorHandle");
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});

async function openAndSave(stops: Array<{ venueId: string; name: string; priceGbp: number | null }>) {
  await act(async () => {
    root.render(createElement(SaveCrawlStory, { stops }));
  });
  const openButton = Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.includes("Save as story"));
  if (!openButton) throw new Error("Save as story button missing.");
  await act(async () => openButton.click());
  const saveButton = Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.includes("Save a permanent link"));
  if (!saveButton) throw new Error("Permanent link button missing.");
  await act(async () => saveButton.click());
}

function gateDialog(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"][aria-modal="true"]');
}

function signIn() {
  gateAuth.user = { id: "account-a" };
  gateAuth.contributionAuth = { userId: "account-a", accessToken: "account-a-token" };
  setProviderIdentity("supabase", "account-a");
  publishAuthActionState({ status: "signed-in", identityResolved: true });
}

const PRICED_STOPS = [
  { venueId: "venue-1", name: "The Dove", priceGbp: 5.5 },
  { venueId: "venue-2", name: "The Ship", priceGbp: null },
];

describe("SaveCrawlStory priced crawls ask the price door's questions", () => {
  it("opens the sign-in door for a signed-out viewer and sends nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await openAndSave(PRICED_STOPS);

    await vi.waitFor(() => {
      expect(gateDialog()?.textContent).toContain("Sign in to contribute");
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelector('a[href*="/crawls/"]')).toBeNull();
  });

  it("shows the age door on an adult_check_required refusal and saves after the one tap", async () => {
    signIn();
    let crawlPosts = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/identity/adult-assertion")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      crawlPosts += 1;
      return crawlPosts === 1
        ? new Response(
            JSON.stringify({ status: "adult_check_required", error: CONTRIBUTION_ADULT_REFUSAL }),
            { status: 409, headers: { "content-type": "application/json" } },
          )
        : new Response(JSON.stringify({ slug: "priced-story" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
    });

    await openAndSave(PRICED_STOPS);

    await vi.waitFor(() => {
      expect(gateDialog()?.textContent).toContain("Confirm your age");
    });
    const firstPost = fetchSpy.mock.calls[0];
    expect(String(firstPost?.[0])).toBe("/api/crawls");
    const init = firstPost?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer account-a-token");
    expect(JSON.parse(String(init.body)).stops).toEqual([
      { venueId: "venue-1", priceGbp: 5.5 },
      { venueId: "venue-2", priceGbp: null },
    ]);
    expect(container.querySelector('a[href*="/crawls/"]')).toBeNull();

    const tap = Array.from(gateDialog()?.querySelectorAll("button") ?? [])
      .find((button) => button.className.includes("contributionGatePrimary"));
    if (!tap) throw new Error("Age tap missing.");
    await act(async () => tap.click());

    await vi.waitFor(() => {
      expect(container.querySelector('a[href*="/crawls/priced-story"]')).not.toBeNull();
    });
    expect(gateDialog()).toBeNull();
    expect(crawlPosts).toBe(2);
  });

  it("names the under-18 answer on file and offers no tap", async () => {
    signIn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ status: "adult_check_failed", error: CONTRIBUTION_UNDER_18_REFUSAL }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );

    await openAndSave(PRICED_STOPS);

    await vi.waitFor(() => {
      expect(gateDialog()?.textContent).toContain(CONTRIBUTION_UNDER_18_REFUSAL);
    });
    expect(gateDialog()?.querySelector(".contributionGatePrimary")).toBeNull();
    expect(container.querySelector('a[href*="/crawls/"]')).toBeNull();
  });
});
