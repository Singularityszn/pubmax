// @vitest-environment jsdom

// What the cover editor SAYS when it could not read the rotation.
//
// "The rotation is empty" and "we could not read the rotation" are two findings.
// The editor already refuses to remove on the second one, but an owner who holds
// a back-compat cover saw nothing at all: the mirror card is withheld (the read
// did not answer, so the editor may not claim that one photo is the whole
// rotation), the list is empty, and the empty sentence was suppressed by the
// held cover. A section that looks blank with no explanation, and the owner only
// learned the read had failed after tapping Remove cover.
//
// Only a real mount reaches that state, because it takes an effect and a failed
// fetch, which is why this file runs in jsdom while the rest of the cover
// coverage renders to a string.

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    createElement("img", { src, alt }),
}));

// The editor reads through `authedActionFetch`, which refuses outright with no
// live session and never reaches the network. Standing in for it here is what
// makes each case ONE deterministic answer to the cover read.
const answer = vi.hoisted(() => ({ next: async (): Promise<Response> => new Response("{}") }));

vi.mock("@/lib/authedFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authedFetch")>()),
  authedActionFetch: () => answer.next(),
}));

import ProfileCoverPhotosEditor from "@/components/profile/ProfileCoverPhotosEditor";
import { profileCoverEmptyLine } from "@/lib/profileCovers";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const DEGRADED_LINE = profileCoverEmptyLine("degraded");
const EMPTY_LINE = profileCoverEmptyLine("ready");
const HELD_COVER = "/api/cover/p1/g1";

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(heldCoverUrls: string[]): Promise<void> {
  await act(async () => {
    root?.render(
      createElement(ProfileCoverPhotosEditor, {
        handle: "alice",
        heldCoverUrls,
        onProfileChanged: () => {},
      }),
    );
  });
  // The load effect awaits a microtask, then the read, then the reader's own
  // chain, and a transient answer would also wait out a 50ms backoff. Give it
  // real elapsed turns rather than a fixed count of microtasks.
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

beforeEach(() => {
  clearSurfaceCache();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.restoreAllMocks();
  clearSurfaceCache();
});

describe("a cover read that could not answer says so", () => {
  it("prints the degraded sentence even while the profile holds a cover", async () => {
    // 403 rather than 5xx: a refusal the reader treats as final.
    answer.next = async () => new Response("{}", { status: 403 });

    await mount([HELD_COVER]);

    // THE DEFECT: `hasCover` was true, so the only sentence in the section was
    // suppressed and the owner was shown an empty-looking field with no reason.
    expect(container.textContent).toContain(DEGRADED_LINE);
    expect(container.textContent).not.toContain(EMPTY_LINE);
  });

  it("still prints it for an owner holding nothing at all", async () => {
    answer.next = async () => new Response("{}", { status: 403 });

    await mount([]);

    expect(container.textContent).toContain(DEGRADED_LINE);
  });

  it("says the field is empty, not broken, once the read answers with no covers", async () => {
    answer.next = async () => Response.json({ status: "ready", covers: [] });

    await mount([]);

    expect(container.textContent).toContain(EMPTY_LINE);
    expect(container.textContent).not.toContain(DEGRADED_LINE);
  });

  it("says neither sentence once the read answers with a rotation", async () => {
    answer.next = async () =>
      Response.json({
        status: "ready",
        covers: [{ id: "c1", position: 1, url: "/api/cover/p1/g2" }],
      });

    await mount([]);

    expect(container.textContent).not.toContain(EMPTY_LINE);
    expect(container.textContent).not.toContain(DEGRADED_LINE);
  });
});
