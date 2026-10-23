import type { PubPalMemoryKind } from "@/lib/pubPal";
import type { PalTaste } from "@/lib/palTaste";

/** The server supplies only owner-bound, confirmed memories. */
export type PalOpeningContext = {
  memories: readonly { kind: PubPalMemoryKind; value: string }[] | null;
  taste: PalTaste | null;
};

export function palOpeningMessage(name: string, context?: PalOpeningContext): string {
  const hello = name ? `Hi, I'm ${name}.` : "Hi.";
  if (context?.memories === null) return `${hello} I could not read your saved memories just now. What kind of night are you planning?`;
  const report = context?.memories.find((memory) => memory.kind === "night_outcome");
  if (report) return `${hello} You told me: "${report.value}" Something similar tonight?`;
  const visit = context?.taste?.lastVisit;
  if (visit?.name) {
    const date = new Date(`${visit.on}T12:00:00Z`);
    const day = Number.isFinite(date.getTime()) ? ` on ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}` : "";
    const pint = visit.recordedPints?.[0];
    const price = pint ? `, with ${pint.drink} at £${pint.priceGbp.toFixed(2)} a pint` : "";
    return `${hello} You logged ${visit.name}${day}${price}. Something similar tonight?`;
  }
  if (context?.taste?.declaredDrink) return `${hello} Your profile says "${context.taste.declaredDrink}". Something along those lines tonight?`;
  return `${hello} What kind of night are you planning?`;
}

export function palOpeningAcceptance(query: string): boolean {
  return /^(?:yes|yes please|yeah|yep|sure|something similar|similar|that sounds good)[.!?]*$/i.test(query.trim());
}

/** A bill describes that reported night. It is never a per-pint search limit. */
export function palOpeningFollowUp(query: string, opening: string): string | null {
  if (!palOpeningAcceptance(query) || !opening.includes("Something similar tonight?")) return null;
  return `${opening.slice(opening.indexOf("You told me:") >= 0 ? opening.indexOf("You told me:") : opening.indexOf("You logged"), opening.indexOf("Something similar tonight?")).trim()} Which area and price per pint should I use for something similar?`;
}
