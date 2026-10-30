import { describe, expect, it } from "vitest";

import { ledgerTitleName } from "@/lib/ledgerTitle";

type Ref = { id: string; name: string; retired?: true };

const index = (refs: Ref[]) => new Map(refs.map((ref) => [ref.id, ref]));

describe("ledger titles for pubs that share a name", () => {
  const refs = index([
    { id: "venue-a", name: "The Crown" },
    { id: "venue-b", name: "The Crown" },
    { id: "venue-c", name: "The Lamb" },
  ]);

  it("adds the pub's own area when another venue has the same name", () => {
    expect(ledgerTitleName({ name: "The Crown", locality: "Islington" }, refs)).toBe("The Crown, Islington");
    expect(ledgerTitleName({ name: "The Crown", locality: "London", primaryBorough: "Hackney" }, refs)).toBe(
      "The Crown, Hackney",
    );
  });

  it("keeps a unique name bare", () => {
    expect(ledgerTitleName({ name: "The Lamb", locality: "Bloomsbury" }, refs)).toBe("The Lamb");
  });

  it("matches names regardless of case and spacing", () => {
    const mixed = index([
      { id: "venue-a", name: "The  Crown" },
      { id: "venue-b", name: "the crown" },
    ]);
    expect(ledgerTitleName({ name: "The Crown", primaryBorough: "Camden" }, mixed)).toBe("The Crown, Camden");
  });

  it("reads an operator suffix as part of the same name", () => {
    const suffixed = index([
      { id: "venue-a", name: "The Moon Under Water" },
      { id: "venue-b", name: "The Moon Under Water - JD Wetherspoon" },
    ]);
    expect(ledgerTitleName({ name: "The Moon Under Water", locality: "Barnet" }, suffixed)).toBe(
      "The Moon Under Water, Barnet",
    );
  });

  it("does not count a pub that left the map", () => {
    const withRetired = index([
      { id: "venue-a", name: "The Crown" },
      { id: "venue-b", name: "The Crown", retired: true },
    ]);
    expect(ledgerTitleName({ name: "The Crown", locality: "Islington" }, withRetired)).toBe("The Crown");
  });
});
