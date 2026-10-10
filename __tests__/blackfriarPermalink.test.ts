import { describe, expect, it } from "vitest";

import { GET as pubGet } from "@/app/pub/[slug]/route";
import { GET as venueGet } from "@/app/venue/[slug]/route";

describe("published Blackfriar permalinks", () => {
  for (const [route, get] of [["pub", pubGet], ["venue", venueGet]] as const) {
    for (const slug of [
      "the-black-friar-blackfriars",
      "the-black-friar-blackfriars-ec4v",
      "the-black-friar-blackfriars-ec4",
      "the-black-friar-ec4v",
      "the-black-friar-ec4",
      "the-blackfriar",
      "venue-eltcmh",
      "venue-1sw9ofl",
    ]) {
      it(`redirects /${route}/${slug} to the surviving venue`, async () => {
        const response = await get(new Request(`http://localhost/${route}/${slug}`), {
          params: Promise.resolve({ slug }),
        });
        expect(response.status).toBe(308);
        expect(response.headers.get("location")).toBe("http://localhost/map?sel=venue-eltcmh");
      });
    }

    it(`refuses the cross-city ambiguous /${route}/the-black-friar alias`, async () => {
      await expect(get(new Request(`http://localhost/${route}/the-black-friar`), {
        params: Promise.resolve({ slug: "the-black-friar" }),
      })).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    });

    it(`preserves the Manchester /${route}/the-black-friar-m3 permalink`, async () => {
      const response = await get(new Request(`http://localhost/${route}/the-black-friar-m3`), {
        params: Promise.resolve({ slug: "the-black-friar-m3" }),
      });
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("http://localhost/map/manchester?sel=venue-mcr-shidtf");
    });
  }
});
