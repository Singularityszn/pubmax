// The wire limit is one number, and every server photo cap reads it.
//
// Contribution battle test D02 (5 Sep 2026): the composer promised 10 MB, the
// Moment and wall routes said 10 MB, and Vercel refused every body over 4.5 MB
// with a plain-text 413 before any of that code ran. This fence holds the one
// figure under the platform's own, and sweeps the tree so no photo cap is
// typed again where the platform cannot honour it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MOMENT_MAX_PHOTO_BYTES } from "@/lib/momentPhotoEditor";
import {
  FUNCTION_REQUEST_BODY_LIMIT_BYTES,
  photoFitsUploadBody,
  UPLOAD_FIELDS_ALLOWANCE_BYTES,
  UPLOAD_PHOTO_MAX_BYTES,
  UPLOAD_PHOTO_MAX_LABEL,
} from "@/lib/uploadBodyLimit";
import { UPLOADED_IMAGE_MAX_BYTES } from "@/lib/uploadedImage.server";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

function sourceFiles(dir: string): string[] {
  const root = join(process.cwd(), dir);
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) out.push(path);
    }
  };
  walk(root);
  return out.map((path) => path.slice(process.cwd().length + 1));
}

describe("one photo on the wire fits inside the function's own body limit", () => {
  it("leaves room for the multipart fields beside it", () => {
    expect(UPLOAD_PHOTO_MAX_BYTES + UPLOAD_FIELDS_ALLOWANCE_BYTES).toBeLessThan(
      FUNCTION_REQUEST_BODY_LIMIT_BYTES,
    );
  });

  it("is the number the platform documents, in the platform's own megabytes", () => {
    expect(FUNCTION_REQUEST_BODY_LIMIT_BYTES).toBe(4_500_000);
    expect(UPLOAD_PHOTO_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(UPLOAD_PHOTO_MAX_LABEL).toBe("4\u00a0MB");
  });

  it("answers the fit question at the boundary", () => {
    expect(photoFitsUploadBody(UPLOAD_PHOTO_MAX_BYTES)).toBe(true);
    expect(photoFitsUploadBody(UPLOAD_PHOTO_MAX_BYTES + 1)).toBe(false);
    expect(photoFitsUploadBody(0)).toBe(false);
    expect(photoFitsUploadBody(Number.NaN)).toBe(false);
  });
});

describe("every server photo cap reads the wire limit", () => {
  it("through the Moment boundary and the shared image journey", () => {
    expect(MOMENT_MAX_PHOTO_BYTES).toBe(UPLOAD_PHOTO_MAX_BYTES);
    expect(UPLOADED_IMAGE_MAX_BYTES).toBe(UPLOAD_PHOTO_MAX_BYTES);
  });

  it("through the map composers, which are the browser's own gate", () => {
    // ONE PLACE THAT ASKS. Each composer used to hold its own copy of the cap
    // and its own list of accepted types, so the wire's figure was quoted
    // twice and the words beside it could drift apart. `photoRefusal`
    // (lib/pintDropReceipt.ts) is the browser's whole half of the rule now, so
    // the fence is on the CALL, and on the leaf still reading the wire.
    for (const file of [
      "components/map/usePintDrops.ts",
      "components/map/VenuePriceSubmit.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain('from "@/lib/pintDropReceipt"');
      expect(source, file).toContain("photoRefusal(file)");
      expect(source, file).not.toContain("UPLOAD_PHOTO_MAX_BYTES");
    }
    const leaf = read("lib/pintDropReceipt.ts");
    expect(leaf).toContain('from "@/lib/uploadBodyLimit"');
    expect(leaf).toContain("file.size > UPLOAD_PHOTO_MAX_BYTES");
    expect(leaf).toContain("${UPLOAD_PHOTO_MAX_LABEL}.");
  });

  it("with no photo cap of any size typed beside a picker", () => {
    // A 4.5 MB photo passed a 5 MB browser gate and came back as the platform's
    // own 413, which the composer could only word as a failed save (PlanAstra,
    // section 2.4). The sweep is on the FIGURE rather than on one wrong value,
    // so the next composer cannot land with a fresh number of its own.
    // A PHOTO cap, which is what this leaf owns: a ceiling on a PDF the harvest
    // reads, or on what a picker will accept before the composer re-encodes it
    // down to fit, is a different number and stays its own. The image proxy is
    // named below for the same reason: it bounds an INBOUND fetch of somebody
    // else's image, which never crosses a function's request body.
    const exempt = new Set([
      "lib/uploadBodyLimit.ts",
      "lib/socialPostMedia.server.ts",
      "app/api/image-proxy/route.ts",
    ]);
    const offenders: string[] = [];
    for (const file of [...sourceFiles("lib"), ...sourceFiles("app/api"), ...sourceFiles("components")]) {
      if (exempt.has(file)) continue;
      const source = read(file);
      if (/PHOTO[A-Z_]*_BYTES\s*=\s*\d+\s*\*\s*1024\s*\*\s*1024/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("with no 10 MB restated anywhere a photo route reads", () => {
    // The leaf itself records the retired figure in its own history. The
    // Social post lane keeps its own figure and is named here on purpose: it is
    // the one photo cap this sweep does not yet own.
    const exempt = new Set(["lib/uploadBodyLimit.ts", "lib/socialPostMedia.server.ts"]);
    const offenders: string[] = [];
    for (const file of [...sourceFiles("lib"), ...sourceFiles("app/api"), ...sourceFiles("components")]) {
      if (exempt.has(file)) continue;
      const source = read(file);
      if (/_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/.test(source) || /\b10 ?MB\b/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
