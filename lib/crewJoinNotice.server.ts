import "server-only";

// Launch plan P0 item 3: tell the host about each join request, and tell the
// guest when the host lets them in.
//
// Delivery is best effort and must not fail the completed join write.
// Missing email keys do not prevent the in-app attempt. Storage or recipient
// lookup failures can prevent delivery. lib/emailProvider.ts owns email delivery.
//
// NO ADDRESS LEAVES. The recipient's address is read from Supabase Auth through
// the service role and handed to the email seam alone. It is never returned
// to a browser and never logged.

import { after } from "next/server";

import { selectEmailProvider, type EmailProvider } from "@/lib/emailProvider";
import { log } from "@/lib/log";
import type { NewNotification } from "@/lib/notifications";
import { notificationsStore } from "@/lib/notificationsStore";
import type { SocialCrewPublicPreviewSource, SocialCrewReadDTO } from "@/lib/socialCrew";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

type CrewJoinNoticeKind = "crew_join_request" | "crew_join_accepted";

export type CrewJoinNotice = {
  kind: CrewJoinNoticeKind;
  recipientHandle: string;
  actorHandle: string;
  crewId: string;
  crewTitle: string;
  /** The join request ID for both a request and its acceptance. Keys the email once per kind. */
  eventId: string;
};

export type CrewJoinNoticeDeps = {
  emit: (input: NewNotification) => Promise<boolean>;
  recipientAddress: (handle: string) => Promise<string | null>;
  emailProvider: () => EmailProvider;
  origin: string;
};

export type CrewJoinNoticeOutcome = { inApp: boolean; email: "sent" | "not_sent" };

type ReadCrew = () => Promise<SocialCrewReadDTO>;

/** The address on the account that owns a handle, or null. Keyless answers null. */
async function accountAddressForHandle(handle: string): Promise<string | null> {
  if (!handle || !isSupabaseConfigured()) return null;
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data: profile, error } = await admin
    .from("profiles")
    .select("user_id")
    .eq("handle", handle)
    .is("tombstoned_at", null)
    .maybeSingle();
  const userId = (profile as { user_id?: unknown } | null)?.user_id;
  if (error || typeof userId !== "string" || !userId) return null;
  const { data, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError) return null;
  return data.user?.email?.trim() || null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The email for one notice: plain text plus the same lines as inline-styled HTML. */
function crewJoinNoticeEmail(
  notice: CrewJoinNotice,
  origin: string,
): { subject: string; text: string; html: string } {
  const url = `${origin}/social/crews/${encodeURIComponent(notice.crewId)}`;
  const actor = `@${notice.actorHandle}`;
  const request = notice.kind === "crew_join_request";
  const subject = request
    ? `${actor} asked to join ${notice.crewTitle}`
    : `You're in: ${notice.crewTitle}`;
  const lines = request
    ? [
      `${actor} asked to join your crawl, ${notice.crewTitle}.`,
      "Let them in or say no on the crawl page.",
    ]
    : [
      `${actor} let you into ${notice.crewTitle}.`,
      "The crawl page has the plan and who is going.",
    ];
  const footer = request
    ? "You get this email because you host this crawl on PUBMAXX."
    : "You get this email because you asked to join this crawl on PUBMAXX.";
  const paragraph = (text: string) =>
    `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:15px;line-height:1.4">${text}</p>`;
  return {
    subject,
    text: [...lines, url, footer].join("\n\n"),
    html: [
      ...lines.map((line) => paragraph(escapeHtml(line))),
      paragraph(`<a href="${escapeHtml(url)}">Open the crawl</a>`),
      paragraph(escapeHtml(footer)),
    ].join(""),
  };
}

/** Deliver one notice: the inbox row, then the email. Never throws. */
export async function deliverCrewJoinNotice(
  notice: CrewJoinNotice,
  deps: CrewJoinNoticeDeps,
): Promise<CrewJoinNoticeOutcome> {
  const inApp = await deps.emit({
    recipientHandle: notice.recipientHandle,
    actorHandle: notice.actorHandle,
    kind: notice.kind,
    subjectRef: notice.crewId,
    subjectLabel: notice.crewTitle,
  }).catch(() => false);

  let email: CrewJoinNoticeOutcome["email"] = "not_sent";
  try {
    const to = await deps.recipientAddress(notice.recipientHandle);
    if (to) {
      const message = crewJoinNoticeEmail(notice, deps.origin);
      const [result] = await deps.emailProvider().send([{
        to,
        ...message,
        idempotencyKey: `crew-join:${notice.kind}:${notice.eventId}`,
      }]);
      if (result?.status === "sent") email = "sent";
    }
  } catch (error) {
    log("warn", "crew_join_notice.email_failed", {
      kind: notice.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { inApp, email };
}

/** A request goes to the host named by the public preview. */
export async function crewJoinRequestNotice(
  read: () => Promise<SocialCrewPublicPreviewSource>,
  requester: { handle: string },
  crewId: string,
  requestId: string,
): Promise<CrewJoinNotice | null> {
  const crew = await read().catch(() => null);
  if (!crew?.hostHandle) return null;
  return {
    kind: "crew_join_request",
    recipientHandle: crew.hostHandle,
    actorHandle: requester.handle,
    crewId,
    crewTitle: crew.title,
    eventId: requestId,
  };
}

/** An acceptance goes to the member identified by the host's decision. */
export async function crewJoinAcceptedNotice(
  read: ReadCrew,
  host: { handle: string },
  crewId: string,
  memberId: string,
  requestId: string,
): Promise<CrewJoinNotice | null> {
  const crew = await read().catch(() => null);
  if (crew?.kind !== "member") return null;
  const member = crew.members.find((candidate) => candidate.memberId === memberId);
  if (!member) return null;
  return {
    kind: "crew_join_accepted",
    recipientHandle: member.handle,
    actorHandle: host.handle,
    crewId,
    crewTitle: crew.title,
    eventId: requestId,
  };
}

/**
 * Deliver a notice after the response. The join write has already succeeded,
 * so the person never waits on a read, an inbox write or an email.
 */
export function deferCrewJoinNotice(build: () => Promise<CrewJoinNotice | null>, origin: string): void {
  after(async () => {
    try {
      const notice = await build();
      if (!notice) return;
      await deliverCrewJoinNotice(notice, {
        emit: (input) => notificationsStore().emit(input),
        recipientAddress: (handle) => accountAddressForHandle(handle).catch(() => null),
        emailProvider: selectEmailProvider,
        origin,
      });
    } catch (error) {
      log("warn", "crew_join_notice.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
