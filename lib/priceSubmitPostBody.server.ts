import "server-only";

import type { PintDropPhotos } from "@/lib/pintDropsStore";

export type PriceSubmitPostBody = Readonly<{
  fields: Record<string, unknown>;
  photos: PintDropPhotos;
}>;

/** JSON or multipart (optional pint_photo) for POST /api/price-submit. */
export async function parsePriceSubmitPostBody(
  request: Request,
): Promise<PriceSubmitPostBody | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
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
    const fields: unknown = await request.json();
    if (fields === null || typeof fields !== "object" || Array.isArray(fields)) return null;
    return {
      fields: fields as Record<string, unknown>,
      photos: { pint: null, venue: null, receipt: null },
    };
  } catch {
    return null;
  }
}
