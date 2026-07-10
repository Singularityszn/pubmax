import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

const LAST_RIDE_RATE_LIMIT = 20;
const LAST_RIDE_RATE_WINDOW_MS = 60_000;

export async function isLastRideLimited(request: Request, scope: string): Promise<boolean> {
  const key = `last-ride:${scope}:${hashIp(clientIp(request))}`;
  return isLimited(key, key, LAST_RIDE_RATE_LIMIT, LAST_RIDE_RATE_WINDOW_MS);
}
