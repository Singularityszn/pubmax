import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPintDropById } from "@/lib/pintDropLookup";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { ANON_HANDLE_LABEL } from "@/lib/pintDropShared";
import {
  buildPintReceipt,
  buildReceiptShareText,
  buildPersonalReceiptShareText,
  formatReceiptItem,
  receiptShareFromSavedDrop,
  type PintReceiptDrop,
} from "@/lib/pintReceipt";
import { shareReceipt } from "@/lib/pintShareAction";

const LOGGED = "2026-11-10T21:14:00.000Z";

const drop: PintReceiptDrop = {
  venueName: "The Sir Christopher Hatton",
  drink: "Guinness",
  measure: "pint",
  priceGbp: 4.7,
  createdAt: LOGGED,
  handle: "thirsty_ted",
  visibility: "public",
  priceEvidence: "unchecked",
};

describe("buildPintReceipt", () => {
  it("prints the pub, the drink, the measure, the price, the London day and the drinker", () => {
    expect(buildPintReceipt(drop)).toEqual({
      venueName: "The Sir Christopher Hatton",
      measure: "Pint",
      drink: "Guinness",
      price: "£4.70",
      loggedOn: "Tue 10 Nov 2026",
      drinker: "@thirsty_ted",
      bill: "Not checked yet",
    });
  });

  it("names the London day, not the server's, for a pint logged after midnight in summer", () => {
    expect(buildPintReceipt({ ...drop, createdAt: "2026-07-10T23:30:00.000Z" }).loggedOn).toBe(
      "Sat 11 Jul 2026",
    );
  });

  it("prints no day for an unreadable timestamp", () => {
    expect(buildPintReceipt({ ...drop, createdAt: "not a date" }).loggedOn).toBeNull();
  });

  it("shows an anonymous drinker as the house label, never a made-up handle", () => {
    expect(buildPintReceipt({ ...drop, visibility: "anonymous" }).drinker).toBe(ANON_HANDLE_LABEL);
    // The public read already swapped the handle for the label.
    expect(buildPintReceipt({ ...drop, handle: ANON_HANDLE_LABEL }).drinker).toBe(ANON_HANDLE_LABEL);
  });

  it("says what the bill check found, and nothing for a row that never had one", () => {
    expect(buildPintReceipt({ ...drop, priceEvidence: "receipt" }).bill).toBe("Checked against the bill");
    expect(buildPintReceipt({ ...drop, priceEvidence: undefined }).bill).toBeNull();
    expect(buildPintReceipt({ ...drop, priceGbp: null }).bill).toBeNull();
  });

  it("prints no price and no drink it was not given", () => {
    const receipt = buildPintReceipt({ ...drop, drink: "  ", priceGbp: null });
    expect(receipt.price).toBeNull();
    expect(receipt.drink).toBeNull();
  });

  it("names a free measure by its own label", () => {
    expect(buildPintReceipt({ ...drop, measure: "other", measureLabel: "Schooner" }).measure).toBe(
      "Schooner",
    );
    expect(buildPintReceipt({ ...drop, measure: undefined }).measure).toBe("Pint");
  });

  it("carries only the drinker's paid price", () => {
    const receipt = buildPintReceipt(drop);
    expect(receipt.price).toBe("£4.70");
    expect(receipt).not.toHaveProperty("listed");
    expect(JSON.stringify(receipt).match(/£[\d.]+/g)).toEqual(["£4.70"]);
  });
});

describe("receiptShareFromSavedDrop", () => {
  const saved = {
    id: "drop-1",
    status: "visible",
    visibility: "public",
    venueId: "venue-hatton",
    drink: "Guinness",
    measure: "pint",
    priceGbp: 4.7,
    createdAt: LOGGED,
    handle: "thirsty_ted",
    priceEvidence: "unchecked",
  } as const;

  it("offers the receipt for a visible public priced drop", () => {
    const share = receiptShareFromSavedDrop(saved, "The Sir Christopher Hatton");
    expect(share?.path).toBe("/p/drop-1");
    expect(share?.receipt.price).toBe("£4.70");
    expect(share?.receipt.venueName).toBe("The Sir Christopher Hatton");
  });

  it("offers an anonymous drop under the house label", () => {
    const share = receiptShareFromSavedDrop({ ...saved, visibility: "anonymous" }, "The Hatton");
    expect(share?.receipt.drinker).toBe(ANON_HANDLE_LABEL);
  });

  it("offers nothing a stranger's link could not open", () => {
    expect(receiptShareFromSavedDrop({ ...saved, visibility: "friends" }, "x")).toBeNull();
    expect(receiptShareFromSavedDrop({ ...saved, visibility: "legacy" }, "x")).toBeNull();
    expect(receiptShareFromSavedDrop({ ...saved, status: "pending" }, "x")).toBeNull();
    expect(receiptShareFromSavedDrop({ ...saved, id: "" }, "x")).toBeNull();
  });

  it("offers no receipt for a drop with no price", () => {
    expect(receiptShareFromSavedDrop({ ...saved, priceGbp: null }, "x")).toBeNull();
  });
});

describe("formatReceiptItem", () => {
  it.each([
    ["pint", "Guinness", "", "Pint of Guinness"],
    ["half", "Guinness", "", "Half of Guinness"],
    ["175ml", "Merlot", "", "Merlot, 175 ml"],
    ["bottle", "Rioja", "", "Rioja, bottle"],
    ["single", "Gin", "", "Gin, single"],
    ["double", "Gin", "", "Gin, double"],
    ["other", "Lager", "Schooner", "Lager, Schooner"],
    ["pint", "", "", "A pint"],
    ["half", "", "", "A half"],
    ["125ml", "", "", "A 125 ml serve"],
    ["175ml", "", "", "A 175 ml serve"],
    ["250ml", "", "", "A 250 ml serve"],
    ["bottle", "", "", "A bottle"],
    ["single", "", "", "A single serve"],
    ["double", "", "", "A double serve"],
    ["other", "", "Schooner", "A Schooner serve"],
  ] as const)("preserves %s with drink '%s' and label '%s'", (measure, drink, measureLabel, expected) => {
    expect(formatReceiptItem(buildPintReceipt({ ...drop, measure, drink, measureLabel }))).toBe(expected);
  });
});

describe("buildReceiptShareText", () => {
  it("carries the drink, the pub, the price and the day", () => {
    expect(buildReceiptShareText(buildPintReceipt(drop))).toBe(
      "Pint of Guinness at The Sir Christopher Hatton, £4.70, Tue 10 Nov 2026. A pint receipt on PUBMAXX.",
    );
  });

  it("names the measure when no drink was named", () => {
    expect(buildReceiptShareText(buildPintReceipt({ ...drop, drink: "" }))).toBe(
      "A pint at The Sir Christopher Hatton, £4.70, Tue 10 Nov 2026. A pint receipt on PUBMAXX.",
    );
  });

  it("keeps a half's price attached to the half", () => {
    expect(buildReceiptShareText(buildPintReceipt({ ...drop, measure: "half", priceGbp: 2.35 }))).toBe(
      "Half of Guinness at The Sir Christopher Hatton, £2.35, Tue 10 Nov 2026. A pint receipt on PUBMAXX.",
    );
  });

  it("keeps a named wine's glass size", () => {
    expect(buildReceiptShareText(buildPintReceipt({ ...drop, drink: "Merlot", measure: "175ml" }))).toBe(
      "Merlot, 175 ml at The Sir Christopher Hatton, £4.70, Tue 10 Nov 2026. A pint receipt on PUBMAXX.",
    );
  });
});

describe("buildPersonalReceiptShareText", () => {
  it("uses personal wording for the author's post-save share", () => {
    expect(buildPersonalReceiptShareText(buildPintReceipt(drop))).toBe(
      "Pint of Guinness at The Sir Christopher Hatton, £4.70, Tue 10 Nov 2026. My receipt on PUBMAXX.",
    );
  });
});

describe("shareReceipt", () => {
  const share = receiptShareFromSavedDrop(
    { id: "drop-1", status: "visible", visibility: "public", priceGbp: 4.7, drink: "Guinness", createdAt: LOGGED, handle: "ted" },
    "The Sir Christopher Hatton",
  )!;
  const origin = "https://pubmaxxing.com";

  it("opens the share sheet with the receipt link", async () => {
    const shareFn = vi.fn(async () => undefined);
    const track = vi.fn();
    const outcome = await shareReceipt(share, {
      origin,
      nav: { share: shareFn },
      shareNatively: async () => "unavailable",
      track,
    });
    expect(outcome).toBe("shared");
    expect(shareFn).toHaveBeenCalledWith({
      title: "My receipt from The Sir Christopher Hatton",
      text: "Pint of Guinness at The Sir Christopher Hatton, £4.70, Tue 10 Nov 2026. My receipt on PUBMAXX.",
      url: "https://pubmaxxing.com/p/drop-1",
    });
    expect(track).toHaveBeenCalledWith("content_shared", { channel: "native", surface: "receipt" });
  });

  it("copies the link when there is no share sheet", async () => {
    const writeText = vi.fn(async () => undefined);
    const outcome = await shareReceipt(share, {
      origin,
      nav: { clipboard: { writeText } },
      shareNatively: async () => "unavailable",
      track: vi.fn(),
    });
    expect(outcome).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(
      "Pint of Guinness at The Sir Christopher Hatton, £4.70, Tue 10 Nov 2026. My receipt on PUBMAXX. https://pubmaxxing.com/p/drop-1",
    );
  });
});

describe("getPintDropById carries what the receipt prints", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    __resetPintDrops();
  });
  afterEach(() => __resetPintDrops());

  it("returns the measure and the bill evidence of a stored drop", async () => {
    addPintDrop({
      id: "receipt-drop",
      venueId: "venue-hatton",
      handle: "thirsty_ted",
      drink: "Guinness",
      measure: "other",
      measureLabel: "Schooner",
      priceGbp: 4.7,
      priceEvidence: "receipt",
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      visibility: "public",
      createdAt: LOGGED,
    } as PintDrop);
    const read = await getPintDropById("receipt-drop");
    expect(read?.measure).toBe("other");
    expect(read?.measureLabel).toBe("Schooner");
    expect(read?.priceEvidence).toBe("receipt");
  });
});
