import { expect, it } from "vitest";
import type { PostHogConfig } from "posthog-js";
import { buildNetworkRequestOptions } from "posthog-js/lib/src/extensions/replay/external/config.js";
import { shouldRecordBody } from "posthog-js/lib/src/extensions/replay/external/network-plugin.js";
import { posthogBrowserConfig } from "@/lib/posthogClient";

it("keeps private API bodies and headers out of replay when remote recording enables them", () => {
  const options = buildNetworkRequestOptions(posthogBrowserConfig as PostHogConfig, {
    recordHeaders: true,
    recordBody: true,
    recordPerformance: true,
  });
  for (const url of ["https://pubmax.test/api/friend-locations", "https://pubmax.test/api/messages"]) {
    for (const type of ["request", "response"] as const) {
      expect(shouldRecordBody({
        type,
        recordBody: options.recordBody,
        headers: { "content-type": "application/json" },
        url,
      })).toBe(false);
    }
  }
  expect(options.recordHeaders).toBe(false);
  expect(options.recordPerformance).toBe(true);
  expect(posthogBrowserConfig.session_recording?.maskCapturedNetworkRequestFn).toBeUndefined();
  const scrubbed = options.maskRequestFn?.({
    name: "https://pubmax.test/api/messages", entryType: "resource", startTime: 0, duration: 1,
    requestHeaders: { authorization: "Bearer disposable-unit-secret" },
    responseHeaders: { "set-cookie": "disposable-unit-cookie" },
  });
  expect(scrubbed?.requestHeaders?.authorization).toBe("redacted");
  expect(scrubbed?.responseHeaders?.["set-cookie"]).toBe("redacted");
});
