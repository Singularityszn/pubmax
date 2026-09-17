import { isPlanIdempotencyKey, type PlanWriteError } from "@/lib/planStore";

const PLAN_WRITE_ERROR_STATUS: Record<PlanWriteError, number> = {
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  account_conflict: 409,
  full: 409,
  error: 503,
  invalid: 400,
  arrival_required: 400,
};

export function planWriteErrorToStatus(error: PlanWriteError): number {
  return PLAN_WRITE_ERROR_STATUS[error] ?? 400;
}

export function planMutationIdempotencyKey(request: Request, body: Record<string, unknown>): string | null {
  const header = request.headers.get("idempotency-key");
  const bodyValue = body.idempotencyKey;
  if (header === null && bodyValue === undefined) return null;
  const value = header ?? (typeof bodyValue === "string" ? bodyValue : null);
  return isPlanIdempotencyKey(value) ? value.trim() : null;
}

export const PLAN_IDEMPOTENCY_ERROR = {
  error: "Add a valid idempotency key before retrying this request.",
  code: "PLAN_IDEMPOTENCY_KEY_REQUIRED",
  retryable: false,
} as const;
