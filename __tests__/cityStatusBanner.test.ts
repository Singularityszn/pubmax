import { describe, expect, it } from "vitest";

import { pickCityStatusHeadline } from "@/components/map/CityStatusBanner";

describe("pickCityStatusHeadline", () => {
  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"])(
    "rejects unsafe sourceUrl scheme %s",
    (sourceUrl) => {
      const headline = pickCityStatusHeadline({
        signals: [{ headline: "Signal headline", sourceUrl }],
      });

      expect(headline).toMatchObject({ text: "Signal headline", kind: "signal" });
      expect(headline?.href).toBeUndefined();
    },
  );

  it("accepts an absolute https sourceUrl", () => {
    const headline = pickCityStatusHeadline({
      signals: [
        {
          headline: "Signal headline",
          sourceUrl: "https://example.com/london-status",
        },
      ],
    });

    expect(headline?.href).toBe("https://example.com/london-status");
  });
});
