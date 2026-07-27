import { clientIp, hashActor, hashIp } from "@/lib/supabase";

/**
 * Device-derived identity shared by every way a first-party price enters the
 * community store. The raw IP never leaves this function.
 */
export function deriveCommunityPriceActor(request: Request): string | undefined {
  try {
    return hashActor(`price-submit:${hashIp(clientIp(request))}`);
  } catch {
    return undefined;
  }
}
