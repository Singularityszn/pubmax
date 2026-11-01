// The board reader (review item A4): a drinker photographs a pub's price board
// and the Pal PROPOSES the lines it can read.
//
//   POST multipart { venueId, photo }  -> 200 { venueId, photo: { sha256 }, proposals, keptOut }
//
// A READ, NEVER A WRITE. Nothing here stores the photo or a price. The answer
// is a list of proposals the page prints as cards; the drinker edits, unticks
// and confirms, and each confirmed row goes through the existing community
// price write (POST /api/price-submit) with this same photo as its bill. So no
// row lands from the model's answer alone (docs/adr/0006, propose then confirm).
//
// THE PHOTO takes the shared owned-image journey (`prepareUploadedImage`): type,
// size, magic bytes, metadata strip, rotate and resize, then JPEG. Only that
// re-encoded JPEG goes to the model, and it is dropped when the answer comes
// back. `photo.sha256` names the photo the proposals were read from, so the
// page can say which bill they belong to; the bytes themselves ride the price
// write as the bill, through that route's own photo checks.
//
// ORDER, cheapest refusal first: the contribution identity (401, 403, 409 or
// 503 from the shared gate), the keyless line, the per-account and per-address
// budgets, the body, the venue, and only then the deployment-wide paid ceiling
// (`board-read`) and the model. A refused caller spends nothing.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  BOARD_READ_KEYLESS_CODE,
  BOARD_READ_KEYLESS_LINE,
} from "@/lib/boardRead";
import { boardReaderKeyed, readBoardPhoto } from "@/lib/boardRead.server";
import { boundedFormData } from "@/lib/boundedRequest.server";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { UPLOAD_FIELDS_ALLOWANCE_BYTES, UPLOAD_PHOTO_MAX_BYTES } from "@/lib/uploadBodyLimit";
import { prepareUploadedImage } from "@/lib/uploadedImage.server";
import { resolveWritableVenueId } from "@/lib/venueWriteTarget.server";

assertServerEnv();

export const runtime = "nodejs";

const HOUR_MS = 60 * 60 * 1000;
/** Reads one account may ask for in an hour. A pub has a board or two. */
const BOARD_READ_ACCOUNT_LIMIT = 6;
/** Reads one address may ask for in an hour, across every account behind it. */
const BOARD_READ_ADDRESS_LIMIT = 20;
/** Long edge of the JPEG the model sees: enough for a chalkboard's small print. */
const BOARD_PHOTO_BOX = 1600;

class BoardPhotoError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function rateLimited(): Response {
  return publicApiError("Too many board reads. Try again in an hour.", "RATE_LIMITED", 429, { retryable: true });
}

/** One venue id and one photo, nothing else. */
async function parseBody(request: Request): Promise<{ venueId: string; photo: File } | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) return null;
  try {
    const form = await boundedFormData(request, UPLOAD_PHOTO_MAX_BYTES + UPLOAD_FIELDS_ALLOWANCE_BYTES);
    if ([...form.keys()].some((key) => key !== "venueId" && key !== "photo")) return null;
    const ids = form.getAll("venueId");
    const photos = form.getAll("photo");
    if (ids.length !== 1 || typeof ids[0] !== "string" || !ids[0].trim()) return null;
    if (photos.length !== 1 || !(photos[0] instanceof File)) return null;
    return { venueId: ids[0].trim(), photo: photos[0] };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const reader = await resolveContributionIdentity(request);
  if (!reader.ok) return jsonNoStore(reader.body, { status: reader.httpStatus });

  // Said before any budget is spent: a deployment with no key reads nothing.
  if (!boardReaderKeyed()) {
    return publicApiError(BOARD_READ_KEYLESS_LINE, BOARD_READ_KEYLESS_CODE, 503);
  }

  const addressKey = `board-read:ip:${hashIp(clientIp(request))}`;
  if (await isLimited(addressKey, addressKey, BOARD_READ_ADDRESS_LIMIT, HOUR_MS, { failClosed: true })) {
    return rateLimited();
  }
  const accountKey = `board-read:actor:${reader.actor}`;
  if (await isLimited(accountKey, accountKey, BOARD_READ_ACCOUNT_LIMIT, HOUR_MS, { failClosed: true })) {
    return rateLimited();
  }

  const body = await parseBody(request);
  if (!body) return publicApiError("Send one photo of the board.", "MALFORMED_REQUEST", 400);

  const venue = await resolveWritableVenueId(body.venueId, { pubsOnly: true });
  if (!venue.ok) return publicApiErrorFromStatus(venue.error, venue.status);

  let prepared;
  try {
    prepared = await prepareUploadedImage(body.photo, {
      outputWidth: BOARD_PHOTO_BOX,
      outputHeight: BOARD_PHOTO_BOX,
      noun: "A board photo",
      maxBytes: UPLOAD_PHOTO_MAX_BYTES,
      fail: (code, message) => new BoardPhotoError(code, message),
    });
  } catch (error) {
    if (error instanceof BoardPhotoError) {
      return publicApiError(error.message, error.code, error.code === "TOO_LARGE" ? 413 : 400);
    }
    return publicApiError("That photo could not be read. Choose another.", "PROCESSING_FAILED", 400);
  }

  // The deployment-wide ceiling, last of all, so only a read that will really
  // reach the model spends from it.
  const refusal = await paidSpendBudgetRefusal("board-read");
  if (refusal) return refusal;

  const read = await readBoardPhoto(prepared.bytes);
  if (read.status === "keyless") {
    return publicApiError(BOARD_READ_KEYLESS_LINE, BOARD_READ_KEYLESS_CODE, 503);
  }
  if (read.status === "failed") {
    return publicApiError("The Pal could not read that board. Try again.", "BOARD_READ_FAILED", 503, {
      retryable: true,
    });
  }
  return jsonNoStore(
    {
      venueId: venue.venueId,
      photo: { sha256: prepared.sha256 },
      proposals: read.proposals,
      keptOut: read.keptOut,
    },
    { status: 200 },
  );
}
