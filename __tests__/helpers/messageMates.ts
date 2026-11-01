import { vi } from "vitest";

import { memoryFollowStore } from "@/lib/followStore";

/**
 * Message plumbing suites test sending, attachments and signals between people
 * who MAY message each other. Until the age check is live, a new conversation
 * needs mates (`MESSAGE_MATES_ONLY`, lib/messageSafety.ts), so these suites
 * treat every pair as mates. The mates rule itself is proven with real follows
 * in __tests__/messageSafetyRoutes.test.ts.
 */
export function treatEveryoneAsMates(): void {
  vi.spyOn(memoryFollowStore, "edgesWith").mockImplementation(async (_handle, others) => ({
    following: new Set(others),
    followers: new Set(others),
  }));
}
