import { describe, expect, it } from "vitest";

import { PAL_RECALL_MEMORY_LIMIT, selectPalMemoriesForAsk } from "@/lib/palMemoryRelevance";
import type { PubPalMemoryKind } from "@/lib/pubPal";

type Memory = { kind: PubPalMemoryKind; value: string };

// A person who has confirmed eleven things: fewer than one turn carries.
const ELEVEN: Memory[] = [
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

// Newest first, as recall hands them over: more than one turn carries, with
// the ones an ask is about at the old end.
const FILLER: Memory[] = Array.from({ length: PAL_RECALL_MEMORY_LIMIT }, (_, index) => ({
  kind: "night_outcome",
  value: `Night out number ${index} was fun`,
}));
const MORE_THAN_A_TURN: Memory[] = [...FILLER, ...ELEVEN];

const values = (memories: Memory[]) => memories.map((memory) => memory.value);

describe("selectPalMemoriesForAsk", () => {
  it("carries every memory when someone has fewer than a turn holds, whatever the ask", () => {
    for (const ask of ["", "Fancy a glass of wine somewhere?", "Tell me everything you know about me."]) {
      expect(new Set(values(selectPalMemoriesForAsk(ELEVEN, ask)))).toEqual(new Set(values(ELEVEN)));
    }
  });

  it("puts the access need first, then what the ask is about", () => {
    const wine = values(selectPalMemoriesForAsk(ELEVEN, "Fancy a glass of wine somewhere?"));
    expect(wine[0]).toBe("Brings a guide dog");
    expect(wine[1]).toBe("Allergic to sulphites, so no wine");

    const home = values(selectPalMemoriesForAsk(ELEVEN, "How am I getting home tonight?"));
    expect(home.slice(0, 3)).toEqual(["Brings a guide dog", "Gets the Northern line home", "Cycles everywhere"]);
  });

  it("past the limit, keeps what the ask is about and drops the newest that are not", () => {
    expect(selectPalMemoriesForAsk(MORE_THAN_A_TURN, "")).toHaveLength(PAL_RECALL_MEMORY_LIMIT);

    const plain = values(selectPalMemoriesForAsk(MORE_THAN_A_TURN, ""));
    expect(plain).toContain("Brings a guide dog");
    expect(plain).not.toContain("Gets the Northern line home");

    const wine = values(selectPalMemoriesForAsk(MORE_THAN_A_TURN, "Fancy a glass of wine somewhere?"));
    expect(wine).toHaveLength(PAL_RECALL_MEMORY_LIMIT);
    expect(wine.slice(0, 2)).toEqual(["Brings a guide dog", "Allergic to sulphites, so no wine"]);

    const fire = values(selectPalMemoriesForAsk(MORE_THAN_A_TURN, "Somewhere cosy by the fire"));
    expect(fire).toContain("Loves a pub with a fireplace");
  });

  it("never drops an access need or a correction, however many memories outrank them", () => {
    const stouts = Array.from({ length: PAL_RECALL_MEMORY_LIMIT + 5 }, (_, index) => ({
      kind: "drink_preference" as const,
      value: `Likes stout number ${index}`,
    }));
    const chosen = values(
      selectPalMemoriesForAsk([...stouts, { kind: "correction", value: "I moved from Hackney to Brixton" }, ...ELEVEN], "What stout should I drink?"),
    );
    expect(chosen).toHaveLength(PAL_RECALL_MEMORY_LIMIT);
    expect(chosen.slice(0, 2)).toEqual(["I moved from Hackney to Brixton", "Brings a guide dog"]);
  });

  it("returns the same objects it was given, so labels and kinds ride along", () => {
    const tagged = ELEVEN.map((memory) => ({ ...memory, label: memory.kind }));
    const chosen = selectPalMemoriesForAsk(tagged, "drink");
    expect(chosen.every((memory) => tagged.includes(memory))).toBe(true);
  });
});
