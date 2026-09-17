import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE ONE RECEIPT THE WHOLE TREE SENDS.
//
// A four-byte `ff d8 ff d9` File passes the server's byte sniffing and is a
// perfectly good stand-in wherever the bytes are never opened. It is NOT one
// where the real upload path runs: `normalizeImage` hands those bytes to sharp,
// which answers `VipsJpeg: JPEG datastream contains no image`, and the write
// fails for a reason the test never meant to exercise.
//
// So a test that reaches the normaliser sends THIS file, the same receipt the
// browser suite attaches (e2e/helpers/priceBill.ts). One file for both suites,
// because two fixtures drift and only one of them gets fixed.

/** The committed receipt photo: a baseline JPEG that decodes. */
const BILL_FIXTURE_PATH = join(process.cwd(), "e2e/fixtures/bill.jpg");

/** The receipt as a `File`, ready for a multipart body. */
export function billFixtureFile(name = "bill.jpg"): File {
  return new File([new Uint8Array(readFileSync(BILL_FIXTURE_PATH))], name, {
    type: "image/jpeg",
  });
}
