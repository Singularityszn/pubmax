import "server-only";

import { boundedFormData, boundedJson } from "@/lib/boundedRequest.server";
import type { PintDropPhotos } from "@/lib/pintDropsStore";
import { FUNCTION_REQUEST_BODY_LIMIT_BYTES } from "@/lib/uploadBodyLimit";

export type PriceSubmitPostBody = Readonly<{
  fields: Record<string, unknown>;
  photos: PintDropPhotos;
}>;

/**
 * JSON or multipart (optional pint_photo) for POST /api/price-submit. Both
 * reads are bounded, so a body past the platform's own ceiling is refused as
 * malformed after one capped read instead of being buffered whole.
 */
export async function parsePriceSubmitPostBody(
  request: Request,
): Promise<PriceSubmitPostBody | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    try {
      const form = await boundedFormData(request, FUNCTION_REQUEST_BODY_LIMIT_BYTES);
      const fields: Record<string, unknown> = {};
      const photos: PintDropPhotos = { pint: null, venue: null, receipt: null };
      for (const [key, value] of form.entries()) {
        if (key === "pint_photo" && value instanceof File && value.size > 0) {
          photos.pint = value;
        } else if (key === "receipt_photo" && value instanceof File && value.size > 0) {
          // The bill behind the price (captain 7 Sept 2026). Read here so the
          // route can ask lib/pintDropReceipt.ts one question about one body.
          photos.receipt = value;
        } else if (typeof value === "string") {
          fields[key] = value;
        }
      }
      return { fields, photos };
    } catch {
      return null;
    }
  }
  try {
    return {
      fields: (await boundedJson(request)) as Record<string, unknown>,
      photos: { pint: null, venue: null, receipt: null },
    };
  } catch {
    return null;
  }
}
