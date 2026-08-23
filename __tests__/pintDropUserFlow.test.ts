import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerFields } from "@/components/map/composer/ComposerFields";
import { pintDropAuthorValue } from "@/lib/pintDropComposerIdentity";

const composerFieldsProps = {
  handle: "night_owl",
  setHandle: vi.fn(),
  accountOwned: true,
  dropForm: { price: "4.2", drink: "Pint", note: "", era: "", withWho: "" },
  setDropForm: vi.fn(),
  vibeTags: [],
  toggleVibeTag: vi.fn(),
  maxTagsReached: false,
  visibility: "public" as const,
  setVisibility: vi.fn(),
  hasActiveRound: false,
  destination: null,
  chooseDestination: vi.fn(),
  setDestination: vi.fn(),
  priceQuickAdds: [4.2],
  lastKnownPrice: null,
  speechSupported: false,
  listening: false,
  speechError: "",
  toggleListening: vi.fn(),
};

describe("venue-sheet Pint Drop author", () => {
  it("uses the signed-in account handle when a fresh device has no local handle", () => {
    expect(
      pintDropAuthorValue({
        accountHandle: "night_owl",
        draftHandle: "",
      }),
    ).toEqual({
      handle: "night_owl",
      accountOwned: true,
    });
  });

  it("keeps keyless demo drafts available when no account handle exists", () => {
    expect(
      pintDropAuthorValue({
        accountHandle: null,
        draftHandle: "demo_drinker",
      }),
    ).toEqual({
      handle: "demo_drinker",
      accountOwned: false,
    });
  });

  it("does not let a stale local draft override account ownership", () => {
    expect(
      pintDropAuthorValue({
        accountHandle: "night_owl",
        draftHandle: "old_device_handle",
      }),
    ).toEqual({
      handle: "night_owl",
      accountOwned: true,
    });
  });

  it("shows the account handle as the composer author on a fresh device", () => {
    const html = renderToStaticMarkup(
      createElement(ComposerFields, composerFieldsProps),
    );

    expect(html).toContain('value="night_owl"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain('aria-readonly="true"');
  });
});
