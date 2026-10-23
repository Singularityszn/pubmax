export function hostnameOf(value: unknown): string | null;
export function hostMatches(host: string, domain: string): boolean;
export function isChainHost(host: string): boolean;
export function classifyChainPub(
  pub: { website?: string | null; operator?: string | null; brewery?: string | null; name?: string | null } | null | undefined,
): { chain: string; harvester: string } | null;
