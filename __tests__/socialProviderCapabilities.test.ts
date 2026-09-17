import { describe, expect, it } from "vitest";

import { SOCIAL_PROVIDERS } from "@/lib/socialConnections";
import {
  SOCIAL_PROVIDER_CAPABILITIES,
  availableProviderCapabilities,
  providerCapability,
  readProviderCapabilities,
} from "@/lib/socialProviderCapabilities";

const CLOSED = {
  manual_link: false,
  oauth_identity: false,
  read_selected_content: false,
  publish: false,
};

describe("reading provider availability off the wire", () => {
  it("gives every known provider a closed row when the answer names only some, in an older shape", () => {
    // The shape e2e/ui-consistency-layout.spec.ts answers: three providers with
    // `oauth`/`manual` flags. The editor indexed the record by every provider
    // and threw on `youtube`, which took the profile page to the error boundary.
    const read = readProviderCapabilities({
      x: { oauth: false, manual: false },
      instagram: { oauth: false, manual: false },
      tiktok: { oauth: false, manual: false },
    });
    expect(Object.keys(read)).toEqual([...SOCIAL_PROVIDERS]);
    for (const provider of SOCIAL_PROVIDERS) expect(read[provider]).toEqual(CLOSED);
  });

  it("keeps what the server granted and grants nothing it did not say with a literal true", () => {
    const read = readProviderCapabilities({
      instagram: { manual_link: true, oauth_identity: "true", publish: 1 },
      website: { manual_link: true },
    });
    expect(read.instagram).toEqual({ ...CLOSED, manual_link: true });
    expect(read.website).toEqual({ ...CLOSED, manual_link: true });
    expect(read.x).toEqual(CLOSED);
  });

  it("closes every provider for a missing or malformed answer", () => {
    for (const value of [null, undefined, "providers", 7, []]) {
      const read = readProviderCapabilities(value);
      for (const provider of SOCIAL_PROVIDERS) expect(read[provider]).toEqual(CLOSED);
    }
  });
});

describe("social provider capabilities", () => {
  it("keeps manual links available without claiming uncertified provider access", () => {
    expect(SOCIAL_PROVIDER_CAPABILITIES.instagram).toEqual({
      manual_link: true,
      oauth_identity: false,
      read_selected_content: false,
      publish: false,
    });
    expect(SOCIAL_PROVIDER_CAPABILITIES.tiktok).toEqual({
      manual_link: true,
      oauth_identity: false,
      read_selected_content: false,
      publish: false,
    });
    expect(SOCIAL_PROVIDER_CAPABILITIES.letterboxd).toEqual({
      manual_link: true,
      oauth_identity: false,
      read_selected_content: false,
      publish: false,
    });
  });

  it("does not infer a broader capability from another capability", () => {
    expect(providerCapability("instagram", "manual_link")).toBe(true);
    expect(providerCapability("instagram", "oauth_identity")).toBe(false);
    expect(providerCapability("instagram", "read_selected_content")).toBe(false);
    expect(providerCapability("instagram", "publish")).toBe(false);
  });

  it("requires runtime readiness after certification", () => {
    const certified = {
      manual_link: true,
      oauth_identity: true,
      read_selected_content: false,
      publish: false,
    };

    expect(availableProviderCapabilities(certified, false).oauth_identity).toBe(false);
    expect(availableProviderCapabilities(certified, true).oauth_identity).toBe(true);
  });
});
