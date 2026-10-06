import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MessageAvatar from "@/components/messages/MessageAvatar";
import { authAvatarInitials } from "@/lib/authAvatarInitials";

describe("MessageAvatar monogram", () => {
  it("draws from the handle when nothing else is printed beside the face", () => {
    expect(renderToStaticMarkup(createElement(MessageAvatar, { handle: "qa_bob" }))).toContain(">Q<");
  });

  it("draws from the name printed beside the face, so the two agree", () => {
    const html = renderToStaticMarkup(
      createElement(MessageAvatar, { handle: "qa_bob", label: "Bob Baker" }),
    );
    expect(html).toContain(">B<");
    expect(html).not.toContain(">Q<");
  });

  it("wears the photo when the row carries one", () => {
    const html = renderToStaticMarkup(
      createElement(MessageAvatar, { handle: "qa_bob", avatarUrl: "/api/profiles/b/avatar?v=1" }),
    );
    expect(html).toContain('src="/api/profiles/b/avatar?v=1"');
  });
});

describe("authAvatarInitials", () => {
  it("never makes an @ the letter on a face", () => {
    expect(authAvatarInitials("@qa_alice")).toBe("Q");
    expect(authAvatarInitials("Alice Archer")).toBe("AA");
    expect(authAvatarInitials("")).toBe("?");
    expect(authAvatarInitials("@")).toBe("?");
  });
});
