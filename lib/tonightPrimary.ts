import type { WhatsOnRow } from "@/lib/whatsOn";

export type TonightPrimaryListing = Pick<WhatsOnRow, "id" | "kind" | "source">;

function sourceHost(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isTonightPrimaryListing(row: TonightPrimaryListing): boolean {
  if (row.kind === "event") return false;
  if (/^deal-jdw-/i.test(row.id)) return false;

  const sourceLabel = row.source.label.toLowerCase().replace(/[^a-z0-9]/g, "");
  const host = sourceHost(row.source.url);
  const isTicketmaster =
    sourceLabel.includes("ticketmaster") ||
    host.includes("ticketmaster");
  const isJdwSource =
    sourceLabel.includes("jdw") ||
    sourceLabel.includes("wetherspoon") ||
    hostIs(host, "jdwetherspoon.com");

  return !isTicketmaster && !isJdwSource;
}

export function tonightPrimaryRows<T extends TonightPrimaryListing>(rows: readonly T[]): T[] {
  return rows.filter((row) => isTonightPrimaryListing(row));
}
