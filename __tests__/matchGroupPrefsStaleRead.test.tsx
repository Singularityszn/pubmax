// @vitest-environment jsdom

// A SLOW GROUP-PREFS READ NEVER OVERWRITES PICKS JUST SAVED.
//
// MatchGroupPrefs reads the plan's shared picks on mount, on a 15-second poll
// and after every save. A read that left before the save and lands after it
// carries the old picks; painting it would un-share the mate's picks, and the
// next save would build its unchanged fields from them. Only the newest read
// may paint (the PlanCollaborationPanel generation-plus-abort pattern).

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MatchGroupPrefs from "@/components/plan/MatchGroupPrefs";
import type { MatePreference } from "@/lib/groupPrefs";

const memberId = "mate-1";
const saved: MatePreference = {
  mateId: memberId,
  budgetBand: "under6",
  atmosphereChips: ["cosy"],
  zeroProof: false,
  accessibilityRequired: false,
  weatherShelterRequired: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let host: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("MatchGroupPrefs read ordering", () => {
  it("keeps the just-saved picks when an older read resolves after the save", async () => {
    const staleRead = deferred<Response>();
    const posts: Array<Record<string, unknown>> = [];
    let gets = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        return Response.json({ pref: { ...saved, ...body } });
      }
      gets += 1;
      // The first read (mount) is the slow one; it answers with the old, empty picks.
      if (gets === 1) return staleRead.promise;
      return Response.json({ prefs: [saved] });
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => root.render(createElement(MatchGroupPrefs, {
      planId: "plan-1",
      memberId,
      memberToken: "token",
      isHost: false,
    })));
    await flush();
    expect(gets).toBe(1);

    await act(async () => button("Under £6").click());
    await act(async () => button("Cosy corners").click());
    await flush();
    expect(posts).toHaveLength(1);
    expect(host.textContent).toContain("Shared with this plan");

    await act(async () => {
      staleRead.resolve(Response.json({ prefs: [] }));
    });
    await flush();

    expect(host.textContent).toContain("Shared with this plan");
    expect(button("Under £6").getAttribute("aria-pressed")).toBe("true");
    expect(button("Cosy corners").getAttribute("aria-pressed")).toBe("true");

    // The next save builds its unchanged fields from the saved picks.
    await act(async () => button("Step-free access").click());
    await flush();
    expect(posts[1]).toMatchObject({ budgetBand: "under6", atmosphereChip: "cosy", accessibilityRequired: true });
  });

  it("keeps the saving picks when a read that starts during the save lands before it answers", async () => {
    const postAnswer = deferred<Response>();
    const afterSaveRead = deferred<Response>();
    const posts: Array<Record<string, unknown>> = [];
    let gets = 0;
    let firstSaveAnswered = false;
    let afterSaveReadSent = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        if (posts.length === 1) {
          const answer = await postAnswer.promise;
          firstSaveAnswered = true;
          return answer;
        }
        return Response.json({ pref: { ...saved, ...body } });
      }
      gets += 1;
      // The read after the first save is slow; every other read (mount, a
      // poll) answers with the old, empty picks.
      if (firstSaveAnswered && !afterSaveReadSent) {
        afterSaveReadSent = true;
        return afterSaveRead.promise;
      }
      return Response.json({ prefs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      act(() => root.render(createElement(MatchGroupPrefs, {
        planId: "plan-1",
        memberId,
        memberToken: "token",
        isHost: false,
      })));
      await flush();
      expect(gets).toBe(1);

      await act(async () => button("Under £6").click());
      await act(async () => button("Cosy corners").click());
      await flush();
      expect(posts).toHaveLength(1);

      // The 15-second poll comes due while the save is out.
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      await flush();

      await act(async () => {
        postAnswer.resolve(Response.json({ pref: { ...saved } }));
      });
      await flush();

      // The read after the save is still out; the saved picks hold.
      expect(button("Under £6").getAttribute("aria-pressed")).toBe("true");
      expect(button("Cosy corners").getAttribute("aria-pressed")).toBe("true");

      expect(host.textContent).toContain("Shared with this plan");

      afterSaveRead.resolve(Response.json({ prefs: [saved] }));
      await flush();
      expect(button("Under £6").getAttribute("aria-pressed")).toBe("true");

      // The next save builds its unchanged fields from the saved picks.
      await act(async () => button("Step-free access").click());
      await flush();
      expect(posts[1]).toMatchObject({ budgetBand: "under6", atmosphereChip: "cosy", accessibilityRequired: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
