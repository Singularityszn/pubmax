import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  loader: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useEffect: (effect: () => void | (() => void)) => {
      harness.effects.push(effect);
    },
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(initial: T) => ({ current: initial }),
    useState: <T,>(initial: T | (() => T)) => {
      const setter = vi.fn();
      harness.setters.push(setter);
      return [typeof initial === "function" ? (initial as () => T)() : initial, setter];
    },
  };
});

vi.mock("@/lib/reactionClient", () => ({
  loadReactionSummaries: harness.loader,
  localReactionSummary: (mine: string[]) => ({ counts: {}, mine }),
  toggleReactionMine: (mine: string[], reaction: string) =>
    mine.includes(reaction)
      ? mine.filter((value) => value !== reaction)
      : [...mine, reaction],
  writeLocalReactions: vi.fn(),
}));

import ProfileTimeline from "@/components/profile/ProfileTimeline";

const DROP = {
  id: "drop-1",
  handle: "alice",
  priceGbp: 6.2,
  drink: "Lager",
  passedDownNote: "",
  era: "",
  provenance: "contributor",
  venueId: "venue-1",
  createdAt: "2026-08-05T20:00:00.000Z",
  vibeTags: [],
  pintPhotoUrl: null,
  venuePhotoUrl: null,
  venueName: "The Test Arms",
  venueMapUrl: "/map?sel=venue-1",
};

beforeEach(() => {
  harness.effects.length = 0;
  harness.setters.length = 0;
  harness.loader.mockReset();
});

describe("ProfileTimeline reaction effect cleanup", () => {
  it("does not consume a successful loader result after cleanup aborts its effect", async () => {
    let resolveLoad!: (value: {
      summaries: Record<string, unknown>;
      retryableIds: Set<string>;
      aborted: boolean;
    }) => void;
    harness.loader.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    ProfileTimeline({ drops: [DROP] });
    const cleanup = harness.effects[0]?.();

    resolveLoad({
      summaries: { "drop-1": { counts: { cheers: 1 }, mine: [] } },
      retryableIds: new Set(["drop-1"]),
      aborted: false,
    });
    cleanup?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.setters[0]).not.toHaveBeenCalled();
  });
});
