// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { revealWhenMounted } from "@/lib/revealWhenMounted";

// Profile Options' "Analytics choices" scrolls to a block inside the account
// hub, which is a dynamic import (#1421). A tap before that chunk landed found
// no block and did nothing (e2e/ui-consistency-layout.spec.ts, "profile Options
// expose working existing actions").

const flushObserver = () => new Promise<void>((resolve) => queueMicrotask(resolve));

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("revealWhenMounted", () => {
  it("reveals at once when the target is already there", () => {
    document.body.innerHTML = '<div id="target"></div>';
    const reveal = vi.fn(() => Boolean(document.getElementById("target")));

    revealWhenMounted(reveal);

    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveLastReturnedWith(true);
  });

  it("reveals a target that mounts after the tap, then stops watching", async () => {
    const reveal = vi.fn(() => Boolean(document.getElementById("target")));

    revealWhenMounted(reveal);
    expect(reveal).toHaveLastReturnedWith(false);

    const late = document.createElement("div");
    late.id = "target";
    document.body.append(late);
    await flushObserver();
    expect(reveal).toHaveBeenCalledTimes(2);
    expect(reveal).toHaveLastReturnedWith(true);

    document.body.append(document.createElement("p"));
    await flushObserver();
    expect(reveal).toHaveBeenCalledTimes(2);
  });

  it("gives up after the wait, so a block that never mounts leaves no observer", async () => {
    vi.useFakeTimers();
    const reveal = vi.fn(() => false);

    revealWhenMounted(reveal, { timeoutMs: 50 });
    vi.advanceTimersByTime(50);
    document.body.append(document.createElement("div"));
    await flushObserver();

    expect(reveal).toHaveBeenCalledTimes(1);
  });
});
