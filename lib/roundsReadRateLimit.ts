import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

const ROUNDS_READ_RATE_LIMIT = 30;
const ROUNDS_READ_RATE_WINDOW_MS = 60_000;

export async function isRoundsReadLimited(request: Request): Promise<boolean> {
  const key = `rounds-read:${hashIp(clientIp(request))}`;
  return isLimited(key, key, ROUNDS_READ_RATE_LIMIT, ROUNDS_READ_RATE_WINDOW_MS);
}
