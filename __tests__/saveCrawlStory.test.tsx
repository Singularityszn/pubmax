// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAccessToken = vi.hoisted(() => vi.fn(async () => "account-a-token"));

vi.mock("@/lib/authClient", () => ({ getAccessToken }));

import SaveCrawlStory from "@/components/crawl/SaveCrawlStory";
import { publishAuthActionState } from "@/lib/authedFetch";
import { setProviderIdentity } from "@/lib/authProviderRevision";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
        stops: [{ venueId: "venue-1", name: "The Dove", priceGbp: 5.5 }],
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
