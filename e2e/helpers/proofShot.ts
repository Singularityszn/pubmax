import { basename } from "node:path";

import type { TestInfo } from "@playwright/test";

/**
 * Where a spec saves a proof picture. A run that asks for proof shots
 * (`PW_PROOF_SHOTS=1`, the opt-in the claim-card and age-door proofs already
 * use) writes the named path under the gitignored artifacts folder, ready to
 * upload to the PR. Any other run saves the picture in the test's own output
 * folder. Proof is never committed.
 */
export function proofShotPath(testInfo: TestInfo, trackedPath: string): string {
  return process.env.PW_PROOF_SHOTS === "1"
    ? trackedPath
    : testInfo.outputPath(basename(trackedPath));
}
