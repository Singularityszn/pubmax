export const SEARCH_CREDIT_COST = 1;
export const EXTRACT_CREDIT_COST = 1;

export type SpendLedger = {
  spent: number;
  exhausted: boolean;
  canSpend(cost: number): boolean;
  record(cost: number): void;
};

export function openSpendLedger(allowanceCredits: number): SpendLedger {
  let spent = 0;
  let exhausted = allowanceCredits <= 0;
  return {
    get spent() {
      return spent;
    },
    get exhausted() {
      return exhausted;
    },
    canSpend(cost: number) {
      return !exhausted && Number.isFinite(cost) && cost >= 0 && spent + cost <= allowanceCredits;
    },
    record(cost: number) {
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
        throw new Error("A Tavily credit cost must be a non-negative number.");
      }
      spent += cost;
      if (spent >= allowanceCredits) exhausted = true;
    },
  };
}

export function reportedCredits(payload: unknown, fallback: number): number {
  if (typeof payload !== "object" || payload === null) return fallback;
  const body = payload as Record<string, unknown>;
  const usage = typeof body.usage === "object" && body.usage !== null ? (body.usage as Record<string, unknown>) : null;
  const raw = usage && "credits" in usage ? usage.credits : body.credits;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  return fallback;
}
