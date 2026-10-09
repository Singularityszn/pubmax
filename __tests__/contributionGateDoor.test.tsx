// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// An account that has not tapped "I'm 18 or over" has no Wanted list and no
// diary to open. Their reads answer the gate as data at 200, and each surface
// puts the door where its list would be: the sentence, and the one tap. It used
// to say "Could not load Wanted places right now" and "We couldn't open your
// diary just now", with nothing to press.

const auth = vi.hoisted(() => ({
  current: {
    accountRevision: 0,
    supabaseAuthState: "authenticated",
    user: { id: "user-1" },
    getCurrentUserId: () => "user-1",
  },
}));
const authedFetch = vi.hoisted(() => vi.fn());
const authedActionFetch = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch, authedActionFetch }));
vi.mock("@/lib/venueMapUrl", () => ({ venueMapUrl: (id: string) => `/map/${id}` }));
vi.mock("@/components/wanted/WantedPromotionControl", () => ({ default: () => null }));

import DiaryList from "@/components/diary/DiaryList";
import WantedListBody from "@/components/wanted/WantedListBody";
import { setProviderIdentity } from "@/lib/authProviderRevision";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const gated = (status: string, error: string) =>
  new Response(JSON.stringify({ status, error }), { status: 200 });

beforeEach(() => {
  setProviderIdentity("supabase", "user-1");
  authedFetch.mockReset();
  authedActionFetch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

describe("Wanted list behind the age gate", () => {
  it("shows the door with the tap instead of a load failure, and reads again after the tap", async () => {
    authedFetch
      .mockResolvedValueOnce(
        gated("adult_check_required", "Confirm you are 18 or over before contributing."),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ wanteds: [] }), { status: 200 }),
      );
    authedActionFetch.mockResolvedValue(
      new Response(JSON.stringify({ assertedAt: "2026-10-06T10:00:00.000Z" }), { status: 200 }),
    );

    await act(async () => {
      root.render(createElement(WantedListBody));
    });
    await settle();

    expect(container.textContent).toContain("Confirm you are 18 or over to keep a Wanted list.");
    expect(container.textContent).not.toContain("Could not load Wanted places");
    // The capture form is not offered while the door stands.
    expect(container.querySelector("#wanted-paste")).toBeNull();

    await act(async () => {
      button("I'm 18 or over")!.click();
    });
    await settle();

    expect(authedActionFetch).toHaveBeenCalledWith(
      "/api/identity/adult-assertion",
      expect.objectContaining({ method: "POST" }),
      { requiresIdentity: true },
    );
    expect(authedFetch).toHaveBeenCalledTimes(2);
    expect(container.querySelector("#wanted-paste")).not.toBeNull();
    expect(container.textContent).toContain("No open Wanted places yet.");
  });

  it("offers no tap to an account whose date of birth says under 18", async () => {
    authedFetch.mockResolvedValue(
      gated("adult_check_failed", "The date of birth on your account is under 18."),
    );

    await act(async () => {
      root.render(createElement(WantedListBody));
    });
    await settle();

    expect(container.textContent).toContain(
      "The date of birth on your account is under 18, so contributing is not open to you.",
    );
    expect(button("I'm 18 or over")).toBeUndefined();
  });

  it("points an account with no handle at the claim door", async () => {
    authedFetch.mockResolvedValue(
      gated("onboarding_required", "Choose a public handle before contributing."),
    );

    await act(async () => {
      root.render(createElement(WantedListBody));
    });
    await settle();

    expect(container.textContent).toContain("Choose a handle to keep a Wanted list.");
    expect(container.querySelector("a")?.textContent).toBe("Choose a handle");
  });
});

describe("One tap for every door on the page", () => {
  it("dissolves the Diary door when the Wanted door takes the tap", async () => {
    // "We ask once" is a promise about the whole page: a tap at one door must
    // not leave the next door asking the question that was just answered.
    authedFetch.mockImplementation(async (url: string) => {
      const answered = authedActionFetch.mock.calls.length > 0;
      if (url === "/api/wanted") {
        return answered
          ? new Response(JSON.stringify({ wanteds: [] }), { status: 200 })
          : gated("adult_check_required", "Confirm you are 18 or over before contributing.");
      }
      return answered
        ? new Response(JSON.stringify({ status: "ready", entries: [] }), { status: 200 })
        : gated("adult_check_required", "Confirm you are 18 or over before contributing.");
    });
    authedActionFetch.mockResolvedValue(
      new Response(JSON.stringify({ assertedAt: "2026-10-06T10:00:00.000Z" }), { status: 200 }),
    );

    await act(async () => {
      root.render(createElement("div", null, createElement(WantedListBody), createElement(DiaryList)));
    });
    await settle();
    expect(container.querySelectorAll(".contributionGateDoor")).toHaveLength(2);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".contributionGateDoor button")!.click();
    });
    await settle();

    expect(container.querySelectorAll(".contributionGateDoor")).toHaveLength(0);
    expect(container.textContent).toContain("No open Wanted places yet.");
    expect(container.textContent).toContain("Nothing logged yet.");
    // One tap was recorded, once.
    expect(authedActionFetch).toHaveBeenCalledTimes(1);
  });
});

describe("Diary list behind the age gate", () => {
  it("shows the door with the tap instead of a load failure", async () => {
    authedFetch.mockResolvedValue(
      gated("adult_check_required", "Confirm you are 18 or over before contributing."),
    );

    await act(async () => {
      root.render(createElement(DiaryList));
    });
    await settle();

    expect(container.textContent).toContain("Confirm you are 18 or over to keep a diary.");
    expect(container.textContent).not.toContain("We couldn't open your diary");
    expect(button("I'm 18 or over")).toBeDefined();
  });
});

describe("Wanted capture behind the age gate", () => {
  it("puts the door under the save, says what it is for, and saves after the tap", async () => {
    const dove = {
      id: "wanted-1",
      ownerActor: "profile:1",
      venueKind: "curated",
      venueId: "venue-dove",
      venueName: "The Dove",
      sourceUrl: "",
      sourcePlatform: "none",
      note: "",
      rawPaste: "The Dove",
      status: "open",
      createdAt: "2026-10-06T10:00:00.000Z",
      fulfilledAt: null,
      promotedListType: null,
      promotedAt: null,
    };
    let posts = 0;
    authedActionFetch.mockImplementation(async (input: string) => {
      if (input === "/api/wanted/resolve") {
        return new Response(
          JSON.stringify({
            query: "Dove",
            sourceUrl: "",
            sourcePlatform: "none",
            rawPaste: "The Dove",
            status: "ready",
            candidates: [
              {
                venueId: "venue-dove",
                venueName: "The Dove",
                venueKind: "curated",
                address: "",
                contextLabel: "Hammersmith",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (input === "/api/wanted") {
        posts += 1;
        return posts === 1
          ? new Response(
              JSON.stringify({
                status: "adult_check_required",
                error: "Confirm you are 18 or over before contributing.",
              }),
              { status: 409 },
            )
          : new Response(JSON.stringify({ wanted: dove }), { status: 201 });
      }
      if (input === "/api/identity/adult-assertion") {
        return new Response(JSON.stringify({ assertedAt: "2026-10-06T10:00:00.000Z" }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected action: ${input}`);
    });
    authedFetch.mockResolvedValue(new Response(JSON.stringify({ wanteds: [] }), { status: 200 }));

    const { default: WantedCapture } = await import("@/components/wanted/WantedCapture");
    const onSaved = vi.fn();
    await act(async () => {
      root.render(createElement(WantedCapture, { onSaved }));
    });
    await act(async () => {
      const paste = container.querySelector<HTMLInputElement>("#wanted-paste")!;
      paste.value = "The Dove";
      paste.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.wantedCapture__submit")!.click();
    });
    await settle();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".wantedCandidate")!.click();
    });
    await settle();

    // A private list is not a public contribution: no dialog, no handle claim.
    expect(document.body.querySelector(".contributionGate")).toBeNull();
    expect(container.textContent).toContain("Confirm you are 18 or over to keep a Wanted list.");
    expect(container.textContent).not.toContain("public handle");
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => {
      button("I'm 18 or over")!.click();
    });
    await settle();

    expect(posts).toBe(2);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "wanted-1" }));
    expect(container.querySelector(".contributionGateDoor")).toBeNull();
  });
});
