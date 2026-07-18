import { describe, expect, it } from "vitest";

// Pure gate logic for the contextual native push pre-permission explainer
// (lib/nativePushPrompt.ts). The iOS permission dialog is one-shot, so this
// must never fire on the web, must never re-fire once enabled, and after a
// "Later" dismissal must wait for a strictly later qualifying plan action
// before offering again.
import { shouldOfferPushPrompt } from "@/lib/nativePushPrompt";

describe("shouldOfferPushPrompt", () => {
  it("never offers on the web, regardless of other state", () => {
    expect(
      shouldOfferPushPrompt({
        isNative: false,
        alreadyEnabled: false,
        dismissedAtSeq: null,
        currentSeq: 5,
      }),
    ).toBe(false);
  });

  it("does not offer before any qualifying action has happened", () => {
    expect(
      shouldOfferPushPrompt({
        isNative: true,
        alreadyEnabled: false,
        dismissedAtSeq: null,
        currentSeq: 0,
      }),
    ).toBe(false);
  });

  it("offers after the first qualifying native plan action", () => {
    expect(
      shouldOfferPushPrompt({
        isNative: true,
        alreadyEnabled: false,
        dismissedAtSeq: null,
        currentSeq: 1,
      }),
    ).toBe(true);
  });

  it("never offers again once the user has enabled push", () => {
    expect(
      shouldOfferPushPrompt({
        isNative: true,
        alreadyEnabled: true,
        dismissedAtSeq: null,
        currentSeq: 3,
      }),
    ).toBe(false);
  });

  it("does not re-offer immediately after a Later dismissal at the same action", () => {
    expect(
      shouldOfferPushPrompt({
        isNative: true,
        alreadyEnabled: false,
        dismissedAtSeq: 1,
        currentSeq: 1,
      }),
    ).toBe(false);
  });

  it("re-offers once a later qualifying action moves the sequence past the dismissal", () => {
    expect(
      shouldOfferPushPrompt({
        isNative: true,
        alreadyEnabled: false,
        dismissedAtSeq: 1,
        currentSeq: 2,
      }),
    ).toBe(true);
  });
});
