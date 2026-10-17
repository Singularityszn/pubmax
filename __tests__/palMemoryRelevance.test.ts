import { describe, expect, it } from "vitest";

import {
  PAL_RECALL_ALL_LIMIT,
  PAL_RECALL_MEMORY_LIMIT,
  selectPalMemoriesForAsk,
} from "@/lib/palMemoryRelevance";
import type { PubPalMemoryKind } from "@/lib/pubPal";

type Memory = { kind: PubPalMemoryKind; value: string };

// Newest first, as recall hands them over. The ones an ask is about sit at the
// old end, past the usual eight.
const NEWEST_FIRST: Memory[] = [
  { kind: "venue_preference", value: "Prefers pubs with food till late" },
  { kind: "atmosphere_preference", value: "Likes a pub quiz on Tuesdays" },
  { kind: "night_outcome", value: "Had a great birthday at The Lamb" },
  { kind: "transport_preference", value: "Cycles everywhere" },
  { kind: "accessibility_preference", value: "Brings a guide dog" },
  { kind: "drink_preference", value: "Drinks cask bitter" },
  { kind: "venue_preference", value: "Likes a proper beer garden" },
  { kind: "atmosphere_preference", value: "Cannot stand sports on the telly" },
  { kind: "drink_preference", value: "Allergic to sulphites, so no wine" },
  { kind: "venue_preference", value: "Loves a pub with a fireplace" },
  { kind: "transport_preference", value: "Gets the Northern line home" },
];

const values = (memories: Memory[]) => memories.map((memory) => memory.value);

describe("selectPalMemoriesForAsk", () => {
  it("with no ask, keeps the access need and fills with the newest", () => {
    const chosen = selectPalMemoriesForAsk(NEWEST_FIRST, "");
    expect(chosen).toHaveLength(PAL_RECALL_MEMORY_LIMIT);
    expect(values(chosen)[0]).toBe("Brings a guide dog");
    expect(values(chosen)).not.toContain("Gets the Northern line home");
  });

  it("finds an old memory the ask is about, past the newest eight", () => {
    const wine = values(selectPalMemoriesForAsk(NEWEST_FIRST, "Fancy a glass of wine somewhere?"));
    expect(wine).toContain("Allergic to sulphites, so no wine");
    // A shared word outranks a shared topic.
    expect(wine.indexOf("Allergic to sulphites, so no wine")).toBeLessThan(wine.indexOf("Drinks cask bitter"));

    const home = values(selectPalMemoriesForAsk(NEWEST_FIRST, "How am I getting home tonight?"));
    expect(home.slice(0, 3)).toEqual(["Brings a guide dog", "Gets the Northern line home", "Cycles everywhere"]);

    const fire = values(selectPalMemoriesForAsk(NEWEST_FIRST, "Somewhere cosy by the fire"));
    expect(fire).toContain("Loves a pub with a fireplace");
  });

  it("never drops an access need or a correction, whatever the ask", () => {
    const withCorrection: Memory[] = [
      ...Array.from({ length: 12 }, (_, index) => ({ kind: "drink_preference" as const, value: `Likes stout number ${index}` })),
      { kind: "correction", value: "I moved from Hackney to Brixton" },
    ];
    const chosen = values(selectPalMemoriesForAsk([...withCorrection, ...NEWEST_FIRST], "What stout should I drink?"));
    expect(chosen).toHaveLength(PAL_RECALL_MEMORY_LIMIT);
    expect(chosen.slice(0, 2)).toEqual(["I moved from Hackney to Brixton", "Brings a guide dog"]);
  });

  it("hands over everything, up to the larger cap, when the ask is about the person", () => {
    expect(selectPalMemoriesForAsk(NEWEST_FIRST, "Tell me everything you know about me.")).toEqual(NEWEST_FIRST);
    const many = Array.from({ length: PAL_RECALL_ALL_LIMIT + 5 }, (_, index) => ({ kind: "venue_preference" as const, value: `Note ${index}` }));
    expect(selectPalMemoriesForAsk(many, "What do you remember about me?")).toHaveLength(PAL_RECALL_ALL_LIMIT);
  });

  it("returns the same objects it was given, so labels and kinds ride along", () => {
    const tagged = NEWEST_FIRST.map((memory) => ({ ...memory, label: memory.kind }));
    const chosen = selectPalMemoriesForAsk(tagged, "drink");
    expect(chosen.every((memory) => tagged.includes(memory))).toBe(true);
  });
});
