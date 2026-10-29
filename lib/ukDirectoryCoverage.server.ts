import "server-only";

import manifest from "@/public/data/uk_base/manifest.json";
import { ukDirectoryCoverage } from "@/lib/ukDirectoryCoverage";

// Only the two counts reach the browser. The country pack remains streamed.
export function loadUkDirectoryCoverage() {
  return ukDirectoryCoverage(manifest);
}
