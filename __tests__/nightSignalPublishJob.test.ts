import { expect, it, vi } from "vitest";
import { publishNightSignalSnapshot } from "@/lib/nightSignalPublishJob.server";

it.each([
  ["fcm_unavailable", "retryable"],
  ["fcm_internal", "retryable"],
  ["fcm_quota_exceeded", "retryable"],
  ["fcm_request_failed", "unknown"],
  ["ServiceUnavailable", "retryable"],
  ["TooManyRequests", "retryable"],
  ["InternalServerError", "retryable"],
  ["Shutdown", "retryable"],
  ["ExpiredProviderToken", "retryable"],
  ["apns_request_failed", "unknown"],
  ["unexpected_failure", "unknown"],
])("records %s as %s", async (reason, status) => {
  const result = await publishNightSignalSnapshot("android", [{ id: "s", title: "Pub", body: "Tonight", entityId: "v" }], {
    claim: async () => true,
    settle: vi.fn(),
    send: async () => ({ targeted: 1, sent: 0, skipped: 0, pruned: 0, errors: 1, results: [{ token: "a", status: "error", reason }] }),
  });
  expect(result.status).toBe(status);
});

it("does not claim an empty snapshot and records a failed send for retry", async () => {
  const claim = vi.fn().mockResolvedValue(true);
  const settle = vi.fn();
  const send = vi.fn().mockResolvedValue({ targeted: 1, sent: 0, skipped: 0, pruned: 0, errors: 1, results: [{ token: "t", status: "error", reason: "web_push_503" }] });
  const deps = { claim, settle, send };
  expect(await publishNightSignalSnapshot("v1", [], deps)).toMatchObject({ status: "empty" });
  expect(claim).not.toHaveBeenCalled();
  expect(await publishNightSignalSnapshot("v1", [{ id: "s", title: "Pub", body: "Tonight", entityId: "v" }], deps)).toMatchObject({ status: "retryable" });
  expect(settle).toHaveBeenCalledWith("v1", expect.any(String), "retryable", expect.objectContaining({ sent: 0, errors: 1 }));
});

it("does not mark a partially delivered broadcast safe to retry", async () => {
  const settle = vi.fn();
  const result = await publishNightSignalSnapshot("v2", [{ id: "s", title: "Pub", body: "Tonight", entityId: "v" }], {
    claim: async () => true,
    settle,
    send: async () => ({ targeted: 2, sent: 1, skipped: 0, pruned: 0, errors: 1, results: [{ token: "a", status: "sent" }, { token: "b", status: "error", reason: "web_push_503" }] }),
  });
  expect(result.status).toBe("unknown");
  expect(settle).toHaveBeenCalledWith("v2", expect.any(String), "unknown", expect.objectContaining({ sent: 1, errors: 1 }));
});
