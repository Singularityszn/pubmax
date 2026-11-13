import { describe, expect, it } from "vitest";

// A suspended account opens and sends no DM (launch plan P0 item 6, 0224).
// The withdrawn-account read is passed in; the refusal is the public contract.

import { MESSAGE_SUSPENDED_REFUSAL } from "@/lib/messageSafety";
import { messageSuspendedRefusal } from "@/lib/messageSafety.server";

describe("messageSuspendedRefusal", () => {
  it("refuses a suspended sender with a 403 that says why", async () => {
    const asked: string[] = [];
    const response = await messageSuspendedRefusal("targetted", async (handle) => {
      asked.push(handle);
      return true;
    });
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ error: MESSAGE_SUSPENDED_REFUSAL, code: "ACCOUNT_SUSPENDED" });
    expect(asked).toEqual(["targetted"]);
  });

  it("admits an active sender", async () => {
    await expect(messageSuspendedRefusal("reporter", async () => false)).resolves.toBeNull();
  });

  it("refuses the send with a retryable 503 when the read cannot run", async () => {
    const unreadable = (): Promise<boolean> => Promise.reject(new Error("withdrawn list unreadable"));
    const response = await messageSuspendedRefusal("reporter", unreadable);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
  });
});
