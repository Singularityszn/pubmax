import { act } from "react";

// THE BILL EVERY PRICED WRITE CARRIES (captain 7 Sept 2026).
//
// Since `lib/pintDropReceipt.ts` the one-tap door keeps `Log it` disabled until
// a photo of the bill is attached, so a jsdom test that taps it without one is
// testing a dead button. ONE helper rather than a copy per spec, so the day the
// picker moves there is one place to follow it.

/** A four-byte JPEG: the leading bytes are what `photoRefusal` reads. */
function billFile(): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "bill.jpg", {
    type: "image/jpeg",
  });
}

/**
 * Attach the bill to the one-tap composer inside `container`.
 *
 * jsdom has no DataTransfer, so the chosen file is defined on the input and the
 * change React listens for is dispatched by hand. The FIRST `.vpsubPhotoInput`
 * is the bill's: the pint photo's picker renders only once the bill is in, and
 * it renders after it.
 */
export async function attachBill(container: HTMLElement): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[class*="vpsubPhotoInput"]');
  if (!input) throw new Error("the bill picker did not render");
  Object.defineProperty(input, "files", { value: [billFile()], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
