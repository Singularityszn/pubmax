import { describe, expect, it } from "vitest";

import {
  APP_NAME,
  BRAND_NAME,
  appPageTitle,
  metadataSiteName,
} from "@/lib/brandNaming";

describe("brand naming (captain 2026-08-17)", () => {
  it("names the brand and app separately", () => {
    expect(BRAND_NAME).toBe("PUBMAXX");
    expect(APP_NAME).toBe("PUBMAXXING");
  });

  it("uses the app name in page titles", () => {
    expect(appPageTitle("Privacy")).toBe("Privacy · PUBMAXXING");
  });

  it("uses the brand in metadata siteName", () => {
    expect(metadataSiteName()).toBe("PUBMAXX");
  });
});
