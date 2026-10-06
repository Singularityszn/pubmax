import { describe, expect, it } from "vitest";

// Pure model tests — no store, no env, no network. Covers pair normalisation,
// participant check, body validation/cleaning, unread counting, and the @-mention
// linkifier.
import {
  cleanBody,
  isParticipant,
  linkifyMentions,
  MAX_MESSAGE_BODY,
  normalizePair,
  conversationRowHandle,
  conversationRowMatches,
  conversationRowName,
  threadCardHandle,
  threadHeaderPrimaryLine,
  threadHeaderSecondaryLine,
  threadIdentityFromInboxRow,
  threadIdentityFromWire,
  unreadForViewer,
} from "@/lib/messages";

describe("normalizePair — lexicographic order + validity", () => {
  it("orders a pair the same regardless of argument order", () => {
    const a = normalizePair("ken", "sam");
    const b = normalizePair("sam", "ken");
    expect(a).toEqual({ handleA: "ken", handleB: "sam" });
    expect(a).toEqual(b);
  });

  it("normalises handles (strips @, lowercases) before ordering", () => {
    expect(normalizePair("@Sam", "KEN")).toEqual({ handleA: "ken", handleB: "sam" });
  });

  it("rejects a self-pair (can't DM yourself)", () => {
    expect(normalizePair("ken", "ken")).toBeNull();
    expect(normalizePair("@Ken", "ken")).toBeNull();
  });

  it("rejects a blank/invalid handle on either side", () => {
    expect(normalizePair("", "sam")).toBeNull();
    expect(normalizePair("ken", "   ")).toBeNull();
    expect(normalizePair("!!!", "sam")).toBeNull();
  });
});

describe("isParticipant — the courtesy check primitive", () => {
  const pair = { handleA: "ken", handleB: "sam" };
  it("accepts either participant (normalising the input)", () => {
    expect(isParticipant(pair, "ken")).toBe(true);
    expect(isParticipant(pair, "@Sam")).toBe(true);
  });
  it("rejects a non-participant and a blank handle", () => {
    expect(isParticipant(pair, "mallory")).toBe(false);
    expect(isParticipant(pair, "")).toBe(false);
  });
});

describe("cleanBody — free-text trust boundary + cap", () => {
  it("strips angle brackets and collapses whitespace", () => {
    expect(cleanBody("  hi   <script>there</script>  ")).toBe("hi scriptthere/script");
  });
  it("returns null for empty / whitespace-only / non-string", () => {
    expect(cleanBody("")).toBeNull();
    expect(cleanBody("   ")).toBeNull();
    expect(cleanBody(null)).toBeNull();
    expect(cleanBody(42)).toBeNull();
  });
  it("caps at MAX_MESSAGE_BODY characters", () => {
    const out = cleanBody("x".repeat(MAX_MESSAGE_BODY + 500));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(MAX_MESSAGE_BODY);
  });
});

describe("unreadForViewer — per-viewer unread count", () => {
  it("counts only unread messages NOT sent by the viewer", () => {
    const rows = [
      { senderHandle: "sam", read: false }, // received, unread → counts
      { senderHandle: "sam", read: true }, // received, read → no
      { senderHandle: "ken", read: false }, // my own → never counts
    ];
    expect(unreadForViewer(rows, "ken")).toBe(1);
  });
  it("is zero for a blank viewer", () => {
    expect(unreadForViewer([{ senderHandle: "sam", read: false }], "")).toBe(0);
  });
});

describe("thread header naming", () => {
  it("names a direct thread by the other participant", () => {
    expect(
      threadHeaderPrimaryLine(
        { kind: "direct", members: ["karan", "tom_the_lamb"], title: null },
        "tom_the_lamb",
        "karan",
      ),
    ).toBe("@tom_the_lamb");
  });

  it("names a group by its title", () => {
    expect(
      threadHeaderPrimaryLine(
        {
          kind: "group",
          members: ["karan", "sam", "maisie"],
          title: "Friday crew",
        },
        "sam",
        "karan",
      ),
    ).toBe("Friday crew");
  });

  it("names an untitled group by its members minus the viewer", () => {
    expect(
      threadHeaderPrimaryLine(
        { kind: "group", members: ["karan", "sam", "maisie"], title: null },
        "sam",
        "karan",
      ),
    ).toMatch(/sam/);
  });

  it("returns null for a direct thread with no other handle yet", () => {
    expect(threadHeaderPrimaryLine(null, "", "karan")).toBeNull();
  });

  it("reads direct membership from the wire without treating it as a group", () => {
    const identity = threadIdentityFromWire({
      kind: "direct",
      members: ["karan", "tom_the_lamb"],
    });
    expect(identity?.kind).toBe("direct");
    expect(
      threadHeaderPrimaryLine(identity, "tom_the_lamb", "karan"),
    ).toBe("@tom_the_lamb");
  });

  it("builds group identity from an inbox row only for group rows", () => {
    expect(
      threadIdentityFromInboxRow({
        id: "c4",
        otherHandle: "tom_the_lamb",
        lastAt: "",
        lastFromMe: false,
        unread: 0,
      }),
    ).toBeNull();
    expect(
      threadIdentityFromInboxRow({
        id: "g1",
        kind: "group",
        otherHandle: "sam",
        memberHandles: ["karan", "sam", "maisie"],
        title: "Pub crawl",
        lastAt: "",
        lastFromMe: false,
        unread: 0,
      })?.kind,
    ).toBe("group");
  });
});

describe("linkifyMentions — light @-mention linkify", () => {
  it("splits a mention out and preserves surrounding text", () => {
    const segs = linkifyMentions("hey @ken check this");
    expect(segs).toEqual([
      { type: "text", text: "hey " },
      { type: "mention", handle: "ken", raw: "@ken" },
      { type: "text", text: " check this" },
    ]);
  });

  it("linkifies a mention at the very start", () => {
    const segs = linkifyMentions("@sam hello");
    expect(segs[0]).toEqual({ type: "mention", handle: "sam", raw: "@sam" });
  });

  it("does NOT treat an email's @host as a mention", () => {
    const segs = linkifyMentions("mail me at ken@host.com");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("reproduces the input when segments are concatenated", () => {
    const input = "yo @ken and @sam!";
    const joined = linkifyMentions(input)
      .map((s) => (s.type === "text" ? s.text : s.raw))
      .join("");
    expect(joined).toBe(input);
  });

  it("returns an empty array for an empty body", () => {
    expect(linkifyMentions("")).toEqual([]);
  });
});

describe("a person with a display name", () => {
  const row = {
    id: "c1",
    otherHandle: "qa_bob",
    lastAt: "2026-10-06T12:00:00Z",
    lastFromMe: false,
  } as const;

  it("is named on the inbox row, with the handle they are found by under it", () => {
    const named = { ...row, otherDisplayName: "Bob Baker" };
    expect(conversationRowName(named, "alice")).toBe("Bob Baker");
    expect(conversationRowHandle(named)).toBe("@qa_bob");
  });

  it("is the handle alone when nobody set a name, so it is never printed twice", () => {
    expect(conversationRowName(row, "alice")).toBe("@qa_bob");
    expect(conversationRowHandle(row)).toBeNull();
    expect(conversationRowName({ ...row, otherDisplayName: "  " }, "alice")).toBe("@qa_bob");
    expect(conversationRowHandle({ ...row, otherDisplayName: "  " })).toBeNull();
  });

  it("never lends a group row a person's name", () => {
    const group = {
      ...row,
      kind: "group" as const,
      title: "Friday",
      memberHandles: ["alice", "qa_bob"],
      otherDisplayName: "Bob Baker",
    };
    expect(conversationRowName(group, "alice")).toBe("Friday");
    expect(conversationRowHandle(group)).toBeNull();
  });

  it("is found in the inbox search by the handle printed under the name", () => {
    const named = { ...row, otherDisplayName: "Bob Baker" };
    expect(conversationRowMatches(named, "alice", "qa_bob")).toBe(true);
    expect(conversationRowMatches(named, "alice", "@QA")).toBe(true);
    expect(conversationRowMatches(named, "alice", "baker")).toBe(true);
    expect(conversationRowMatches(named, "alice", "")).toBe(true);
    expect(conversationRowMatches(named, "alice", "carol")).toBe(false);
  });

  it("heads a direct thread with the name, and the handle under it", () => {
    expect(threadHeaderPrimaryLine(null, "qa_bob", "alice", "Bob Baker")).toBe("Bob Baker");
    expect(threadHeaderSecondaryLine(null, "qa_bob", "Bob Baker")).toBe("@qa_bob");
    expect(threadHeaderPrimaryLine(null, "qa_bob", "alice")).toBe("@qa_bob");
    expect(threadHeaderSecondaryLine(null, "qa_bob", undefined)).toBeNull();
    expect(threadHeaderPrimaryLine(null, "", "alice", "Bob Baker")).toBeNull();
  });

  it("asks for the card of the other person on a direct thread and of nobody on a group", () => {
    const group = { kind: "group" as const, members: ["alice", "qa_bob"], title: null };
    expect(threadCardHandle(null, "qa_bob")).toBe("qa_bob");
    expect(threadCardHandle(group, "qa_bob")).toBeNull();
    expect(threadCardHandle(null, "")).toBeNull();
  });
});
