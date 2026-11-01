import { basename } from "node:path";

import type { TestInfo } from "@playwright/test";

/**
 * Where a spec saves a picture that also lives in docs/proof. A committed
 * proof shot is rewritten only when the run asks for it (`PW_PROOF_SHOTS=1`,
 * the opt-in the claim-card and age-door proofs already use). Any other run
 * saves the picture in the test's own output folder, so the nightly suite
 * and a local run leave the tree clean and still keep the shot.
 */
export function proofShotPath(testInfo: TestInfo, trackedPath: string): string {
  return process.env.PW_PROOF_SHOTS === "1"
    ? trackedPath
    : testInfo.outputPath(basename(trackedPath));
}
