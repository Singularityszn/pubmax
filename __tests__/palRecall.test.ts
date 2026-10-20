import { describe, expect, it } from "vitest";

import { palRecall } from "@/lib/palRecall";

describe("palRecall", () => {
  it("recalls a subject the drinker raised earlier in the thread", () => {
    const recall = palRecall(
      ["Quiet pub in Camden for four", "cheaper"],
      "anything in Camden with a garden",
    );
    expect(recall?.topic).toBe("Camden");
    expect(recall?.line).toBe("You asked about Camden earlier.");
  });

  it("says nothing about the turn directly above", () => {
    expect(palRecall(["Quiet pub in Camden"], "Camden again")).toBeNull();
  });

  it("says nothing on the first ask of a thread", () => {
    expect(palRecall([], "Quiet pub in Camden")).toBeNull();
  });

  it("recalls the earliest shared subject, not the latest", () => {
    const recall = palRecall(
      ["Live music in Shoreditch", "quiz in Camden", "cheaper"],
      "music or a quiz, either",
    );
    expect(recall?.topic).toBe("music");
  });

  it("does not recall a word that is in every ask", () => {
    expect(
      palRecall(
        ["cheapest pint tonight", "somewhere quiet"],
        "cheapest pint tonight please",
      ),
    ).toBeNull();
  });

  it("prints the subject the way it was written", () => {
    const recall = palRecall(
      ["Anything near LONDON BRIDGE", "cheaper"],
      "london bridge again",
    );
    expect(recall?.topic).toBe("LONDON");
  });

  it.each(["area", "patch", "neighborhood", "neighbourhood"])("does not recall budget follow-up wording for the same %s", (area) => {
    expect(palRecall([
      "Find four pubs in Soho",
      `Same ${area}, under £6.80 a pint`,
      `Same ${area}, under £6.70 a pint`,
    ], `Same ${area}, under £6.60 a pint`)).toBeNull();
    expect(palRecall([
      `Same ${area}, under £6.80 a pint in Soho`,
      "anything else?",
    ], `Same ${area}, under £6.60 a pint in Soho`)).toEqual({ topic: "Soho", line: "You asked about Soho earlier." });
  });
});
