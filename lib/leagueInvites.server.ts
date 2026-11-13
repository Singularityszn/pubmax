import "server-only";

import { leagueStore } from "@/lib/leagueStore";
import { leagueInvitePath } from "@/lib/leagues";
import type { LeagueViewer } from "@/lib/leagues.server";
import { broadcastMessageSent, deferMessagesSignal } from "@/lib/messagesBroadcast.server";
import { messagesStore } from "@/lib/messagesStore";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";
import { summonableMates } from "@/lib/summonMates.server";

export async function leagueInviteMates(viewer: LeagueViewer, id: string): Promise<string[] | null> {
  if (!(await leagueStore().read(id, viewer.authUserId))) return null;
  return summonableMates(viewer);
}

export async function sendLeagueInvite(
  viewer: LeagueViewer,
  id: string,
  recipient: string,
): Promise<"sent" | "not_found" | "not_mate" | "unavailable"> {
  const found = await leagueStore().read(id, viewer.authUserId);
  if (!found) return "not_found";
  const mate = normalizeViewerHandle(recipient);
  if (!(await summonableMates(viewer)).includes(mate)) return "not_mate";
  const sender = normalizeViewerHandle(viewer.handle);
  const store = messagesStore();
  const conversationId = await store.openConversation(sender, mate);
  if (!conversationId) return "unavailable";
  const link = new URL(leagueInvitePath(found.league.inviteCode), PRODUCTION_SITE_ORIGIN).href;
  const message = await store.send(conversationId, sender, `Join us in ${found.league.name}. ${link}`);
  if (!message) return "unavailable";
  deferMessagesSignal(() => broadcastMessageSent(conversationId, [sender, mate]));
  return "sent";
}
