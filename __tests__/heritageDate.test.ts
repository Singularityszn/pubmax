import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AGE_EVIDENCE_DATE_TYPES,
  HERITAGE_DATE_RULES,
  HERITAGE_DATE_TYPES,
  classifyHeritageDate,
  heritageDateCandidates,
  heritageDateClauseAround,
  heritageDateIsAgeEvidence,
} from "../lib/heritageDate.mjs";

// F07. The Captain Kidd card showed 1701, the year the pirate it is named after
// was hanged at Execution Dock, and the index sorted the pub among the oldest
// in London on it. A year in a cited sentence is not the pub's own date, so a
// date carries a value, a precision and the TYPE of event it dates, and only an
// age-evidence type may order a pub by age.

const ROOT = path.join(__dirname, "..");

type Row = {
  name: string;
  slug: string;
  era: string | null;
  dateValue?: string | null;
  datePrecision?: string | null;
  dateType?: string | null;
  dateLabel?: string | null;
  facts: { fact: string }[];
};

function historicRows(): Row[] {
  return JSON.parse(
    readFileSync(path.join(ROOT, "public/data/historic_pubs.json"), "utf8"),
  ) as Row[];
}

function byName(name: string): Row {
  const found = historicRows().find((r) => r.name === name);
  if (!found) throw new Error(`no historic record named ${name}`);
  return found;
}

describe("the date vocabulary", () => {
  it("is a closed set that keeps unknown in it", () => {
    expect(HERITAGE_DATE_TYPES).toEqual([
      "founding",
      "first_mention",
      "construction",
      "reopening",
      "associated_event",
      "unknown",
    ]);
  });

  it("counts only the three types that say how old a pub is as age evidence", () => {
    expect(AGE_EVIDENCE_DATE_TYPES).toEqual([
      "founding",
      "first_mention",
      "construction",
    ]);
    for (const type of ["reopening", "associated_event", "unknown"]) {
      expect(heritageDateIsAgeEvidence(type)).toBe(false);
    }
  });

  it("gives every rule a type in the vocabulary and a label word", () => {
    for (const rule of HERITAGE_DATE_RULES) {
      expect(HERITAGE_DATE_TYPES).toContain(rule.type);
      expect(rule.label.length).toBeGreaterThan(2);
    }
  });
});

describe("reading a date out of cited prose", () => {
  it("finds nothing where the text states nothing", () => {
    expect(classifyHeritageDate("pub in the City of London")).toBeNull();
    expect(classifyHeritageDate("")).toBeNull();
    expect(classifyHeritageDate(null)).toBeNull();
  });

  it("reads years and centuries with their precision", () => {
    expect(heritageDateCandidates("built 1667, on a 15th-century cellar")).toEqual([
      { value: "1667", precision: "year", sortYear: 1667, index: 6 },
      { value: "15th century", precision: "century", sortYear: 1400, index: 17 },
    ]);
  });

  it("bounds a clause at a sentence or semicolon, not at a decimal point", () => {
    const { clause } = heritageDateClauseAround("listed in 1977; rebuilt in 1880", 10);
    expect(clause).toBe("listed in 1977");
    const { clause: kept } = heritageDateClauseAround(
      "the clock stopped at 10.40pm in 1915",
      33,
    );
    expect(kept).toContain("10.40pm");
  });
});

describe("an associated event never becomes a founding date", () => {
  it("types the year the pub was named for, and refuses it as an age", () => {
    const date = classifyHeritageDate(
      "The Captain Kidd at 108 Wapping High Street is a Grade II listed riverside pub in a converted former warehouse, named after the pirate William Kidd, who was hanged at the nearby Execution Dock in 1701.",
    );
    expect(date?.value).toBe("1701");
    expect(date?.precision).toBe("year");
    expect(date?.type).toBe("associated_event");
    expect(date?.ageSortYear).toBeNull();
    expect(date?.label).toBe("Linked to 1701");
  });

  it.each([
    [
      "a wartime raid",
      "The Dolphin Tavern at 44 Red Lion Street, Holborn, was badly damaged by a Zeppelin raid on 8 September 1915.",
      "1915",
    ],
    [
      "a listing designation",
      "Ye Olde Cock Tavern is a Grade II listed pub at 22 Fleet Street, listed in 1977.",
      "1977",
    ],
  ])("refuses %s as an age", (_label, text, value) => {
    const date = classifyHeritageDate(text);
    expect(date?.value).toBe(value);
    expect(date?.type).toBe("associated_event");
    expect(date?.ageSortYear).toBeNull();
  });

  it("keeps a real age when the same sentence also states an event", () => {
    const date = classifyHeritageDate(
      "The Bull's Head, Barnes, is a riverside pub whose present building dates from 1846; it opened as a jazz venue in 1959.",
    );
    expect(date?.value).toBe("1846");
    expect(date?.type).toBe("construction");
    expect(date?.ageSortYear).toBe(1846);
  });

  it("lets the nearest cue speak, not the loudest one in the clause", () => {
    // "dates from" sits against 1897; "named after" is thirty characters on and
    // is about the dining room, not the building.
    const date = classifyHeritageDate(
      "The Dog and Duck at 18 Bateman Street, Soho, is a Grade II listed pub; the current building dates from 1897 and its upstairs dining room is named after the writer George Orwell.",
    );
    expect(date?.type).toBe("construction");
    expect(date?.label).toBe("Built 1897");
  });
});

describe("unknown stays unknown", () => {
  it("does not promote a year with no cue near it", () => {
    const date = classifyHeritageDate(
      "notable pub and meeting place in London in the 18th and 19th centuries",
    );
    expect(date?.type).toBe("unknown");
    expect(date?.ageSortYear).toBeNull();
    expect(date?.label).toBe("19th century");
  });
});

describe("the label always states what the date is of", () => {
  it.each([
    ["Victorian Pimlico pub from 1846.", "Founded 1846"],
    ["The building was built in about 1667.", "Built 1667"],
    ["An 18th-century timber-framed former warehouse.", "Built 18th century"],
    ["A pub has stood on the site since 1583.", "Founded 1583"],
    ["Private drinking club in Soho (1948-2008).", "Founded 1948"],
  ])("labels %s as %s", (text, label) => {
    expect(classifyHeritageDate(text)?.label).toBe(label);
  });
});

describe("the shipped index", () => {
  it("no longer dates The Captain Kidd to the pirate's hanging", () => {
    const kidd = byName("The Captain Kidd");
    expect(kidd.era).toBeNull();
    expect(kidd.dateValue).toBe("1701");
    expect(kidd.dateType).toBe("associated_event");
    expect(kidd.dateLabel).toBe("Linked to 1701");
  });

  it("keeps a founding date where the source states one", () => {
    const queens = byName("The Queens Arms");
    expect(queens.era).toBe("1846");
    expect(queens.dateType).toBe("founding");
    expect(queens.dateLabel).toBe("Founded 1846");
  });

  it("never carries an era whose type is not age evidence", () => {
    const offences = historicRows()
      .filter((r) => r.era !== null && !heritageDateIsAgeEvidence(r.dateType))
      .map((r) => `${r.name}: era ${r.era} typed ${r.dateType}`);
    expect(offences).toEqual([]);
  });

  it("labels every stated date, so no year on a card stands bare", () => {
    const offences = historicRows()
      .filter((r) => r.dateValue != null && !r.dateLabel?.includes(r.dateValue))
      .map((r) => r.name);
    expect(offences).toEqual([]);
  });

  it("still dates the pubs whose sources really state an age", () => {
    const dated = historicRows().filter((r) => r.era !== null);
    expect(dated.length).toBeGreaterThanOrEqual(25);
  });
});
