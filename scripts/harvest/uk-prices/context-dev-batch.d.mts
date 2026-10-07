export function selectUnreadHosts(
  ledger: { hosts?: Record<string, { outcome?: string; pubs?: number; drops?: Record<string, number>; contextDev?: unknown }> },
  options?: { skipHosts?: string[] },
): string[];

export function accountIsOut(answer: { outcome: string; reason?: string; evidence?: string; statusCode?: number }): boolean;
