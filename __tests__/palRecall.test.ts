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

  it.each(["Show", "Find", "Recommend", "Suggest", "Give me", "List", "Best", "Pick"])("does not mistake the command %s for a remembered interest", (command) => {
    expect(palRecall([
      `${command} five pubs in Soho`,
      "Something cheaper",
    ], `${command} a couple of pubs in Camden`)).toBeNull();
    expect(palRecall([
      `${command} five pubs in Soho`,
      "Something cheaper",
    ], `${command} a couple more pubs in Soho`)).toEqual({ topic: "Soho", line: "You asked about Soho earlier." });
  });

  it.each([
    ["Give me a couple more in Soho", "Give me a couple more in Camden"],
    ["Anything that has a garden in Soho", "Anything that has music in Camden"],
    ["Use only your venue records in Soho", "Use only your venue records in Camden"],
  ])("does not turn shared request wording into a remembered subject: %s", (earlier, current) => {
    expect(palRecall([earlier, "Something cheaper"], current)).toBeNull();
  });

  it("does not match an area inside a longer word", () => {
    expect(palRecall(["A Camden pub", "Something cheaper"], "Camdenish places")).toBeNull();
  });

  it.each(["Waterloo", "Bank", "Covent Garden", "Farringdon", "Mayfair"])("recalls the complete place %s", (area) => {
    expect(palRecall([`Pubs near ${area}`, "Something cheaper"], `More near ${area}`))
      .toEqual({ topic: area, line: `You asked about ${area} earlier.` });
  });

  it.each(["bank holiday", "Bank holidays"])("does not mistake %s for the Bank area", (phrase) => {
    expect(palRecall([`Pubs open on the ${phrase}`, "cheaper"], `Anything open ${phrase} in Camden`)).toBeNull();
    expect(palRecall([`Pubs near Bank on the ${phrase}`, "cheaper"], "More near Bank"))
      .toEqual({ topic: "Bank", line: "You asked about Bank earlier." });
  });

  it("does not recall the garden inside Covent Garden as an outdoor preference", () => {
    expect(palRecall(["Pubs near Covent Garden", "Something cheaper"], "A beer garden in Camden")).toBeNull();
  });

  it("matches both apostrophe forms while retaining the person's spelling", () => {
    expect(palRecall(["Pubs near King’s Cross", "Something cheaper"], "More near King's Cross"))
      .toEqual({ topic: "King’s Cross", line: "You asked about King’s Cross earlier." });
  });

  it("prints the subject the way it was written", () => {
    const recall = palRecall(
      ["Anything near LONDON BRIDGE", "cheaper"],
      "london bridge again",
    );
    expect(recall?.topic).toBe("LONDON BRIDGE");
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
