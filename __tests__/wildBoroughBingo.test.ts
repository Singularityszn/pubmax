import { describe, expect, it } from "vitest";
import { boroughBingoSquares } from "@/lib/wildBoroughBingo";

describe("borough bingo", () => {
  it("uses the 32 boroughs and a City of London free square", () => {
    const squares = boroughBingoSquares([], []);
    expect(squares).toHaveLength(33);
    expect(squares.filter((square) => square.kind === "free")).toEqual([{ kind: "free", borough: "City of London" }]);
  });

  it("marks only a known borough with a matching Been venue", () => {
    const squares = boroughBingoSquares(
      [{ venueId: "lamb", venueName: "The Lamb" }, { venueId: "missing", venueName: "Lost" }, { venueId: "unknown", venueName: "Unknown" }, { venueId: "cafe", venueName: "A cafe" }],
      [{ id: "lamb", borough: "Camden" }, { id: "unknown", borough: "Unknown place" }, { id: "other", borough: "Hackney" }, { id: "cafe", borough: "Hackney", kind: "cafe" }],
    );
    expect(squares.find((square) => square.borough === "Camden")).toEqual({ kind: "visited", borough: "Camden", venueId: "lamb", venueName: "The Lamb" });
    expect(squares.find((square) => square.borough === "Hackney")).toEqual({ kind: "empty", borough: "Hackney" });
    expect(squares.find((square) => square.borough === "City of London")).toEqual({ kind: "free", borough: "City of London" });
  });
});
