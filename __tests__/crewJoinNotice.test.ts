// Launch plan P0 item 3: the host hears about each join request, and the
// guest hears when the host lets them in. Each notice is an in-app
// notification plus an email through the one email seam. Without email keys
// the in-app notice still lands and nothing throws.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const lifecycle = vi.hoisted(() => ({ after: vi.fn<(task: () => Promise<void>) => void>() }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: lifecycle.after,
}));

import {
  crewJoinAcceptedNotice,
  crewJoinRequestNotice,
  deferCrewJoinNotice,
  deliverCrewJoinNotice,
  type CrewJoinNotice,
  type CrewJoinNoticeDeps,
} from "@/lib/crewJoinNotice.server";
import { createResendEmailProvider, noopEmailProvider, type EmailProvider } from "@/lib/emailProvider";
import {
  __resetMemoryNotifications,
  memoryNotificationsStore,
} from "@/lib/notificationsStore";
import type { SocialCrewPageDTO, SocialCrewPublicPreviewSource, SocialCrewReadDTO } from "@/lib/socialCrew";

const CREW = "4f6b0c1e-2a7d-4c55-9a3e-1b2c3d4e5f60";
const REQUEST = "5a6b0c1e-2a7d-4c55-9a3e-1b2c3d4e5f61";
const MEMBER = "6b6b0c1e-2a7d-4c55-9a3e-1b2c3d4e5f62";
const ORIGIN = "https://pubmaxxing.com";

const requestNotice: CrewJoinNotice = {
  kind: "crew_join_request",
  recipientHandle: "soho_host",
  actorHandle: "new_face",
  crewId: CREW,
  crewTitle: "Thursday in Soho",
  eventId: REQUEST,
};

type Sent = Parameters<EmailProvider["send"]>[0][number];

function resendStub(status = 200): { provider: EmailProvider; sent: Sent[]; bodies: unknown[] } {
  const sent: Sent[] = [];
  const bodies: unknown[] = [];
  const provider = createResendEmailProvider({
    config: () => ({ apiKey: "re_test_key", from: "PUBMAXX <hello@pubmaxxing.com>" }),
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(status < 300 ? { id: "email-1" } : { name: "internal_server_error" }), { status });
    },
  });
  return {
    sent,
    bodies,
    provider: {
      send: async (messages) => {
        sent.push(...messages);
        return provider.send(messages);
      },
    },
  };
}

function deps(overrides: Partial<CrewJoinNoticeDeps> = {}): CrewJoinNoticeDeps {
  return {
    emit: (input) => memoryNotificationsStore.emit(input),
    recipientAddress: async (handle) => (handle === "soho_host" ? "host@example.com" : handle === "new_face" ? "guest@example.com" : null),
    emailProvider: () => noopEmailProvider,
    origin: ORIGIN,
    ...overrides,
  };
}

beforeEach(() => {
  __resetMemoryNotifications();
  lifecycle.after.mockReset();
});

describe("request lifecycle delivery", () => {
  it("waits for the response lifecycle before building and delivering a keyless notice", async () => {
    const build = vi.fn(async () => requestNotice);
    deferCrewJoinNotice(build, ORIGIN);

    expect(build).not.toHaveBeenCalled();
    expect((await memoryNotificationsStore.list("soho_host")).unread).toBe(0);
    await lifecycle.after.mock.calls[0]![0]();
    expect((await memoryNotificationsStore.list("soho_host")).unread).toBe(1);
  });

  it("contains a failed notice read inside the lifecycle callback", async () => {
    deferCrewJoinNotice(async () => { throw new Error("read failed"); }, ORIGIN);

    await expect(lifecycle.after.mock.calls[0]![0]()).resolves.toBeUndefined();
    expect((await memoryNotificationsStore.list("soho_host")).unread).toBe(0);
  });
});

describe("delivering a crew join notice", () => {
  it("puts the request in the host's inbox and emails the host once, with a link to the crew", async () => {
    const resend = resendStub();
    const outcome = await deliverCrewJoinNotice(requestNotice, deps({ emailProvider: () => resend.provider }));

    expect(outcome).toEqual({ inApp: true, email: "sent" });
    const inbox = await memoryNotificationsStore.list("soho_host");
    expect(inbox.unread).toBe(1);
    expect(inbox.notifications[0]).toMatchObject({
      kind: "crew_join_request",
      actorHandle: "new_face",
      subjectRef: CREW,
      subjectLabel: "Thursday in Soho",
    });
    expect(resend.sent).toHaveLength(1);
    expect(resend.sent[0]!.to).toBe("host@example.com");
    expect(resend.sent[0]!.idempotencyKey).toBe(`crew-join:crew_join_request:${REQUEST}`);
    expect(resend.sent[0]!.text).toContain(`${ORIGIN}/social/crews/${CREW}`);
    expect(resend.sent[0]!.html).toContain(`${ORIGIN}/social/crews/${CREW}`);
  });

  it("still lands the in-app notice when email keys are absent, and sends nothing", async () => {
    const outcome = await deliverCrewJoinNotice(requestNotice, deps({ emailProvider: () => noopEmailProvider }));
    expect(outcome).toEqual({ inApp: true, email: "not_sent" });
    expect((await memoryNotificationsStore.list("soho_host")).unread).toBe(1);
  });

  it("never throws when the address lookup or the email provider fails", async () => {
    const failing = resendStub(500);
    await expect(deliverCrewJoinNotice(requestNotice, deps({
      emailProvider: () => failing.provider,
    }))).resolves.toEqual({ inApp: true, email: "not_sent" });
    await expect(deliverCrewJoinNotice(requestNotice, deps({
      recipientAddress: async () => { throw new Error("auth down"); },
    }))).resolves.toEqual({ inApp: true, email: "not_sent" });
    await expect(deliverCrewJoinNotice(requestNotice, deps({
      emailProvider: () => ({ send: async () => { throw new Error("boom"); } }),
    }))).resolves.toEqual({ inApp: true, email: "not_sent" });
  });

  it("does not email a recipient with no address on file", async () => {
    const resend = resendStub();
    const outcome = await deliverCrewJoinNotice(
      { ...requestNotice, recipientHandle: "no_email" },
      deps({ emailProvider: () => resend.provider }),
    );
    expect(outcome).toEqual({ inApp: true, email: "not_sent" });
    expect(resend.sent).toHaveLength(0);
  });

  it("escapes the crew title and handle in the email markup", async () => {
    const resend = resendStub();
    await deliverCrewJoinNotice(
      { ...requestNotice, crewTitle: "<b>Pints</b> & co" },
      deps({ emailProvider: () => resend.provider }),
    );
    expect(resend.sent[0]!.html).not.toContain("<b>Pints</b>");
    expect(resend.sent[0]!.html).toContain("&lt;b&gt;Pints&lt;/b&gt; &amp; co");
  });
});

describe("who each notice goes to", () => {
  const preview: SocialCrewPublicPreviewSource = {
    crewId: CREW,
    title: "Thursday in Soho",
    startsAt: "2026-11-12T19:00:00.000Z",
    hostHandle: "soho_host",
    stopVenueId: "venue-a",
    stopVenueName: "The First",
  };
  const page = {
    kind: "member",
    crewId: CREW,
    title: "Thursday in Soho",
    owner: { memberId: "host-member", handle: "soho_host" },
    members: [
      { memberId: "host-member", handle: "soho_host", role: "owner", joinedAt: "2026-11-07T10:00:00.000Z" },
      { memberId: MEMBER, handle: "new_face", role: "member", joinedAt: "2026-11-07T11:00:00.000Z" },
    ],
  } as unknown as SocialCrewPageDTO;
  const read = (dto: SocialCrewReadDTO) => async () => dto;

  it("sends a request to the host named on the public preview", async () => {
    expect(await crewJoinRequestNotice(async () => preview, { handle: "new_face" }, CREW, REQUEST)).toEqual(requestNotice);
  });

  it("sends nothing when the preview names no host", async () => {
    const noHost: SocialCrewPublicPreviewSource = { ...preview, hostHandle: "" };
    expect(await crewJoinRequestNotice(async () => noHost, { handle: "new_face" }, CREW, REQUEST)).toBeNull();
  });

  it("sends an acceptance to the member the decision created, from the host", async () => {
    expect(await crewJoinAcceptedNotice(read(page), { handle: "soho_host" }, CREW, MEMBER, REQUEST)).toEqual({
      kind: "crew_join_accepted",
      recipientHandle: "new_face",
      actorHandle: "soho_host",
      crewId: CREW,
      crewTitle: "Thursday in Soho",
      eventId: REQUEST,
    });
  });

  it("uses distinct email identities when two accepted requests reuse the same member", async () => {
    const secondRequest = "8d6b0c1e-2a7d-4c55-9a3e-1b2c3d4e5f64";
    const resend = resendStub();
    for (const requestId of [REQUEST, secondRequest]) {
      const notice = await crewJoinAcceptedNotice(read(page), { handle: "soho_host" }, CREW, MEMBER, requestId);
      expect(notice).not.toBeNull();
      await deliverCrewJoinNotice(notice!, deps({ emailProvider: () => resend.provider }));
    }

    expect(resend.sent.map((message) => ({ to: message.to, key: message.idempotencyKey }))).toEqual([
      { to: "guest@example.com", key: `crew-join:crew_join_accepted:${REQUEST}` },
      { to: "guest@example.com", key: `crew-join:crew_join_accepted:${secondRequest}` },
    ]);
    expect(resend.bodies).toHaveLength(2);
  });

  it("sends nothing when the new member is not on the page, or the read fails", async () => {
    expect(await crewJoinAcceptedNotice(read(page), { handle: "soho_host" }, CREW, "7c6b0c1e-2a7d-4c55-9a3e-1b2c3d4e5f63", REQUEST)).toBeNull();
    expect(await crewJoinAcceptedNotice(async () => { throw new Error("down"); }, { handle: "soho_host" }, CREW, MEMBER, REQUEST)).toBeNull();
    expect(await crewJoinRequestNotice(async () => { throw new Error("down"); }, { handle: "new_face" }, CREW, REQUEST)).toBeNull();
  });
});
