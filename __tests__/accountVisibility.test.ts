// THE ACCOUNT-VISIBILITY VOCABULARY, and the two places it is mirrored.
//
// `lib/accountVisibility.ts` is a pure leaf, so this suite needs no DOM, no
// request and no store. It holds three things: the closed word set, the parse
// (whose two failure directions are the whole point), and the copy bar, because
// a privacy setting that explains itself vaguely is a privacy setting nobody
// can act on.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_VISIBILITIES,
  ACCOUNT_VISIBILITY_COPY,
  accountIsPrivate,
  accountPrivateNotice,
  DEFAULT_ACCOUNT_VISIBILITY,
  isAccountVisibility,
  parseAccountVisibility,
} from "@/lib/accountVisibility";

const MIGRATION = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260908090000_0154_account_visibility.sql"),
  "utf8",
);

describe("the account-visibility vocabulary", () => {
  it("is two closed words and the default is public", () => {
    expect([...ACCOUNT_VISIBILITIES]).toEqual(["public", "private"]);
    expect(DEFAULT_ACCOUNT_VISIBILITY).toBe("public");
    expect(isAccountVisibility("public")).toBe(true);
    expect(isAccountVisibility("private")).toBe(true);
    expect(isAccountVisibility("friends")).toBe(false);
  });

  // Mirrored in SQL the way lib/drinks.ts is mirrored by the drink CHECKs, so a
  // third word is a migration rather than a value the column would happily take.
  it("is mirrored by migration 0154's own CHECK", () => {
    const list = ACCOUNT_VISIBILITIES.map((word) => `'${word}'`).join(", ");
    expect(MIGRATION).toContain(`check (visibility in (${list}))`);
    expect(MIGRATION).toContain(`default '${DEFAULT_ACCOUNT_VISIBILITY}'`);
  });
});

describe("parseAccountVisibility", () => {
  it("reads either word back", () => {
    expect(parseAccountVisibility("public")).toBe("public");
    expect(parseAccountVisibility("private")).toBe("private");
  });

  // A row written before migration 0154 carries no such column at all, and
  // nobody could have chosen private yet, so public STATES what those rows are.
  it("reads an ABSENT value as the public default", () => {
    expect(parseAccountVisibility(undefined)).toBe("public");
    expect(parseAccountVisibility(null)).toBe("public");
    expect(parseAccountVisibility("")).toBe("public");
    expect(parseAccountVisibility("   ")).toBe("public");
  });

  // The opposite direction, and the reason the two cases are separate: a word
  // we cannot read was written by something that is not this app, and it is not
  // a licence to publish somebody's bio.
  it("fails CLOSED on a value it does not recognise", () => {
    for (const junk of ["PUBLIC", "Private", "friends", "secret", 1, {}, [], true]) {
      expect(parseAccountVisibility(junk)).toBe("private");
    }
  });

  it("answers one question through accountIsPrivate", () => {
    expect(accountIsPrivate("private")).toBe(true);
    expect(accountIsPrivate("public")).toBe(false);
    expect(accountIsPrivate(undefined)).toBe(false);
    expect(accountIsPrivate("nonsense")).toBe(true);
  });
});

describe("the copy bar", () => {
  const withheldWords = ["bio", "city", "favourite drink", "work"];

  it("names what each choice covers rather than claiming privacy in the abstract", () => {
    for (const word of withheldWords) {
      expect(ACCOUNT_VISIBILITY_COPY.explainer.public.toLowerCase()).toContain(word);
    }
    // The private line names who still reads what, and what stays visible.
    expect(ACCOUNT_VISIBILITY_COPY.explainer.private).toContain("mates");
    expect(ACCOUNT_VISIBILITY_COPY.explainer.private.toLowerCase()).toContain("handle");
  });

  // The boundary is stated BESIDE the choice, not discovered afterwards. A price
  // is evidence about a pub and stays public under the standing rule that we
  // keep the prices, so the setting may never be read as covering one.
  it("says out loud that a logged price is not covered", () => {
    const line = ACCOUNT_VISIBILITY_COPY.pricesStay.toLowerCase();
    expect(line).toContain("price");
    expect(line).toContain("map");
    expect(line).toContain("never about the evidence");
  });

  it("offers a stranger the way in rather than a closed door", () => {
    const notice = accountPrivateNotice();
    expect(notice.title).toBe("This account is private.");
    expect(notice.body).toContain("add you back");
  });

  it("carries no dash separator and no exclamation in any line", () => {
    const lines = [
      ACCOUNT_VISIBILITY_COPY.legend,
      ...Object.values(ACCOUNT_VISIBILITY_COPY.label),
      ...Object.values(ACCOUNT_VISIBILITY_COPY.explainer),
      ACCOUNT_VISIBILITY_COPY.pricesStay,
      ACCOUNT_VISIBILITY_COPY.strangerTitle,
      ACCOUNT_VISIBILITY_COPY.strangerBody,
      ...Object.values(ACCOUNT_VISIBILITY_COPY.saved),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/\u2014/);
      expect(line).not.toMatch(/ \u2013 /);
      expect(line).not.toContain("!");
    }
  });
});
