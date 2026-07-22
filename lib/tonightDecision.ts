export type TonightDecisionListingState =
  | "checking"
  | "ready"
  | "quiet"
  | "unavailable";

export type WhatsOnLoadState = "idle" | "ready" | "empty" | "error";

export type TonightDecisionOption = {
  id: "one-pub" | "three-stop" | "whats-on";
  href: string;
  title: string;
  detail: string;
};

export type TonightDecisionModel = {
  proof: string;
  options: readonly TonightDecisionOption[];
};

export function tonightDecisionListingState(
  status: WhatsOnLoadState,
): TonightDecisionListingState {
  switch (status) {
    case "ready":
      return "ready";
    case "empty":
      return "quiet";
    case "error":
      return "unavailable";
    default:
      return "checking";
  }
}

const OPTIONS: readonly TonightDecisionOption[] = [
  {
    id: "one-pub",
    href: "/near?source=tonight-decision",
    title: "One good pub",
    detail: "Nearby, price first",
  },
  {
    id: "three-stop",
    href: "/plan?source=tonight-decision",
    title: "Three-stop crawl",
    detail: "Put the night in order",
  },
  {
    id: "whats-on",
    href: "#tonight-listings",
    title: "What\u2019s on",
    detail: "Quiz, music, sport and deals",
  },
] as const;

function listingProof(
  state: TonightDecisionListingState,
  listingCount: number,
): string {
  const count = Number.isFinite(listingCount)
    ? Math.max(0, Math.floor(listingCount))
    : 0;
  if (state === "checking") return "Checking tonight\u2019s sourced listings";
  if (state === "unavailable") return "The map and planner are ready";
  if (state === "quiet") return "Quiet listings, full pub map";
  return `${count} sourced ${count === 1 ? "listing" : "listings"} tonight`;
}

export function buildTonightDecisionModel(input: {
  listingState: TonightDecisionListingState;
  listingCount: number;
  areaLabel?: string | null;
}): TonightDecisionModel {
  const area = input.areaLabel?.trim();
  const proof = listingProof(input.listingState, input.listingCount);
  return {
    proof: area ? `${area} \u00b7 ${proof}` : proof,
    options: OPTIONS,
  };
}
